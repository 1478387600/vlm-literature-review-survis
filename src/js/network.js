/**
 * 网络可视化模块 - 使用D3.js实现关键词共现网络可视化
 * 
 * 主要功能：
 * 1. 根据文献关键词共现关系构建网络图
 * 2. 提供交互式可视化界面，支持缩放、拖拽、高亮等操作
 * 3. 动态计算节点大小、边权重等视觉编码
 * 
 * 依赖：
 * - D3.js v5+ (用于可视化渲染)
 * - bib.js (提供文献数据和关键词频率)
 */
const network = (function () {

    return {
        hidden: false, // 是否隐藏网络图
        minKeywordFrequency: null, // 关键词最小出现频率阈值(null表示自动计算)
        minEdgeWeight: 0.7, // 边的最小权重阈值(0-1范围)
        edgeStrength: 1.0, // 边的强度系数(影响布局力导向)
        
        /**
         * 更新网络可视化
         * 
         * 功能：
         * 1. 清空现有可视化
         * 2. 计算新的网络图数据
         * 3. 使用D3.js渲染可视化
         * 
         * 触发条件：
         * - 文献筛选条件变化
         * - 网络参数调整
         */
        update: function () {
            $('#network_vis').empty();
            if (this.hidden) return;
            const width = $('#timeline').width() - 3;
            const height = width * 0.75;
            var chart = d3.select('#network_vis')
                .append('svg')
                .attr('class', 'chart')
                .style('border', '1px solid black')
                .attr('height', height + 'px')
                .attr('width', width + 'px')
                .append('svg:g');
            d3.select('#network_vis').call(d3.zoom().on("zoom", function () {
                chart.attr("transform", d3.event.transform)
            }));
            graph = computeGraph();
            layout(graph, chart, width, height);
        }
    }

    /**
     * 计算网络图数据结构
     * 
     * 处理流程：
     * 1. 筛选满足频率阈值的关键词作为节点
     * 2. 计算关键词共现关系作为边
     * 3. 计算节点和边的各种权重指标
     * 
     * 算法细节：
     * - 节点频率: 关键词在所有文献中出现的次数
     * - 边权重: 标准化共现频率 (共现次数/源节点频率)
     * - 边重要性: min(freqA,freqB)/max(freqA,freqB) 衡量节点间频率平衡性
     * - 节点相对重要性: sqrt(freq/N) * sqrt(freq/max(freq,neighborFreq))
     *   其中N是文献总数，neighborFreq是相邻节点频率和
     * 
     * @returns {Object} 包含nodes和links的网络图对象
     *   - nodes: Array<{
     *     id: string,          // 关键词ID
     *     frequency: number,   // 出现频率
     *     relativeImportance: number // 计算后的相对重要性
     *   }>
     *   - links: Array<{
     *     source: string,      // 源节点ID
     *     target: string,      // 目标节点ID
     *     weight: number,      // 标准化权重(0-1)
     *     importance: number   // 边重要性(0-1)
     *   }>
     */
    function computeGraph() {
        // 获取当前筛选条件下的文献总数
        const nEntries = Object.keys(bib.filteredEntries).length;
        
        // 构建节点数组：筛选满足最小频率的关键词
        const nodes = Object.keys(bib.keywordFrequencies)
            .filter(keyword => bib.keywordFrequencies[keyword] >= network.minKeywordFrequency)
            .map(keyword => { 
                return { 
                    'id': keyword, 
                    'frequency': bib.keywordFrequencies[keyword] 
                }; 
            });
        const links = [];
        // 关键词共现矩阵: 记录每对关键词共同出现的次数
        const keywordCoOccurrence = {};
        
        // 遍历所有文献构建共现矩阵
        Object.keys(bib.filteredEntries).forEach(entry => {
            const keywords = bib.parsedEntries[entry].keywords;
            
            // 对每篇文献中的关键词两两组合计数
            keywords.forEach(keywordA => {
                if (!keywordCoOccurrence[keywordA]) {
                    keywordCoOccurrence[keywordA] = {};
                }
                keywords.forEach(keywordB => {
                    if (!keywordCoOccurrence[keywordA][keywordB]) {
                        keywordCoOccurrence[keywordA][keywordB] = 0;
                    }
                    // 避免自环边(keywordA === keywordB的情况已在后续过滤)
                    keywordCoOccurrence[keywordA][keywordB] += 1;
                });
            });
        });
        // 构建边数组：基于共现矩阵创建符合条件的边
        nodes.forEach(nodeA => {
            nodes.forEach(nodeB => {
                // 避免自环边和重复计算(无向图)
                if (nodeA.id < nodeB.id) {  // 按字母序比较确保每条边只添加一次
                    // 计算标准化权重: 共现次数/源节点频率
                    const weight = keywordCoOccurrence[nodeA.id][nodeB.id] / 
                                 bib.keywordFrequencies[nodeA.id];
                    
                    // 只保留权重超过阈值的边
                    if (weight > network.minEdgeWeight) {
                        links.push({
                            'source': nodeA.id,
                            'target': nodeB.id,
                            'weight': weight,  // 标准化权重(0-1)
                        });
                    }
                }
            });
        });
        // 计算边的重要性指标
        links.forEach(linkA => {
            // 重要性 = min(freqA,freqB)/max(freqA,freqB)
            // 衡量节点间频率的平衡性(值越接近1表示两节点频率越接近)
            linkA.importance = Math.min(
                bib.keywordFrequencies[linkA.source], 
                bib.keywordFrequencies[linkA.target]
            ) / Math.max(
                bib.keywordFrequencies[linkA.source], 
                bib.keywordFrequencies[linkA.target]
            );
        });

        // 计算节点的相对重要性指标
        nodes.forEach(node => {
            // 计算相邻节点的频率总和
            let neighborhoodNodeSizes = 0;
            links.forEach(link => {
                if (link.source === node.id) {
                    neighborhoodNodeSizes += bib.keywordFrequencies[link.target];
                }
            });

            // 相对重要性公式:
            // sqrt(节点频率/文献总数) * sqrt(节点频率/max(节点频率,邻居频率和))
            // 第一部分衡量全局重要性，第二部分衡量局部重要性
            node.relativeImportance = 
                Math.pow(bib.keywordFrequencies[node.id] / nEntries, 0.5) *
                Math.pow(
                    bib.keywordFrequencies[node.id] / 
                    Math.max(bib.keywordFrequencies[node.id], neighborhoodNodeSizes), 
                    0.5
                );
        });
        return { links, nodes };
    }

    /**
     * 网络图布局和渲染
     * 
     * 使用D3.js力导向布局算法实现网络可视化，主要功能：
     * 1. 力导向布局配置：
     *    - 连接力：基于边权重和重要性
     *    - 电荷力：节点间排斥力
     *    - 定位力：将图保持在视图中心
     * 2. 视觉编码规则：
     *    - 节点大小：与关键词频率的平方根成正比
     *    - 边宽度：基于权重(非线性放大)
     *    - 标签显示：动态计算可见性
     * 3. 交互功能：
     *    - 缩放和平移
     *    - 节点拖拽
     *    - 鼠标悬停高亮关联节点
     * 
     * 实现细节：
     * - 使用d3.forceSimulation创建力导向布局
     * - 节点半径公式：3 + sqrt(frequency)*0.2 (确保最小可见性)
     * - 边透明度基于重要性，宽度基于权重^5 (突出强关联)
     * - 高性能优化：使用SVG groups管理元素，减少DOM操作
     * 
     * @param {Object} graph - 网络图数据(computeGraph的输出)
     *   - nodes: 节点数组，包含id、frequency等属性
     *   - links: 边数组，包含source、target、weight等属性
     * @param {d3.Selection} chart - D3选择器指向SVG容器
     * @param {number} width - 可视化区域宽度(px)
     * @param {number} height - 可视化区域高度(px)
     */
    function layout(graph, chart, width, height) {
        // 视觉编码常量
        const defaultNodeColor = '#999';      // 默认节点颜色
        const highlightedNodeColor = 'black'; // 主高亮颜色(当前悬停节点)
        const highlightedNodeColor2 = '#666'; // 次高亮颜色(关联节点)
        const nLabels = 15;                   // 基准标签显示数量
        const minLabelsRatio = 0.2;           // 最小标签显示比例

        // 创建力导向模拟器
        network.simulation = d3.forceSimulation()
            // 连接力配置：基于边权重和重要性
            .force('link', d3.forceLink()
                .id(d => d.id)  // 指定节点ID访问器
                // 边强度公式：edgeStrength * (0.9*重要性*权重 + 0.1)
                // - 0.9和0.1的权重确保即使弱边也有基本连接力
                .strength(link => network.edgeStrength * (0.9 * link.importance * link.weight + 0.1)))
            // 电荷力配置：节点间排斥力(-100表示排斥强度)
            .force('charge', d3.forceManyBody().strength(-100))
            // 定位力：将图中心固定在视图中心
            .force('x', d3.forceX(width / 2))
            .force('y', d3.forceY(height / 2))

        // 1. 在 <defs> 中定义渐变和滤镜
        const defs = chart.append('defs');

        // 渐变：重要性越高，颜色越靠近深蓝
        const grad = defs.append('linearGradient')
        .attr('id', 'link-gradient')
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '100%').attr('y2', '0%');
        grad.append('stop').attr('offset', '0%').attr('stop-color', '#d1e3f0');
        grad.append('stop').attr('offset', '100%').attr('stop-color', '#1f4e79');

        // 阴影滤镜：轻微投影
        defs.append('filter')
        .attr('id', 'shadow')
        .append('feDropShadow')
            .attr('dx', 0).attr('dy', 1).attr('stdDeviation', 1)
            .attr('flood-color', '#000').attr('flood-opacity', 0.2);

        // 箭头标记（可选）
        defs.append('marker')
        .attr('id', 'arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 10).attr('refY', 0)
        .attr('markerWidth', 6).attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#1f4e79');
        
        // 1. 定义最大边宽，不超过节点直径的一半（或根据需要调整）  
        const maxEdgeWidth = network.nodeRadius;

        // 2. 绘制边
        const link = chart.append('g')
        .attr('fill', 'none')
        .selectAll('path')
        .data(graph.links)
        .join('path')
            .attr('class', 'link')
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round')
            // —— 新：根据重要性由浅灰到黑色 ——  
            .attr('stroke', d => d3.interpolateRgb('#ddd', '#000')(d.importance))
            // 只给很重要的边加一点投影
            .attr('filter', d => d.importance > 0.7 ? 'url(#shadow)' : null)
            // 透明度：平滑过渡到 1  
            .attr('stroke-opacity', d => 0.5 + 0.5 * Math.pow(d.importance, 0.8))
            // —— 新：宽度先计算再 clamp，不超过 maxEdgeWidth ——  
            .attr('stroke-width', d => {
            const raw = 1 + 3 * Math.pow(d.weight, 1.5);        // 原始映射
            return Math.min(raw, maxEdgeWidth);                // 限制最大值
            })
            // 分层虚线
            .attr('stroke-dasharray', d => {
            if      (d.weight > 0.95) return '';               
            else if (d.weight > 0.8)  return '4 2';            
            else if (d.weight > 0.6)  return '6 2 1 2';        
            else                       return '2 2';           
            })
            // 有向图箭头
            .attr('marker-end', d => network.directed ? 'url(#arrow)' : null)
            // 3. 交互：hover 高亮
            .on('mouseover', function(event, d) {
            d3.select(this)
                .transition().duration(150)
                .attr('stroke-width', +d3.select(this).attr('stroke-width') * 1.5)
                .attr('stroke-opacity', 1);
            })
            .on('mouseout', function(event, d) {
            d3.select(this)
                .transition().duration(150)
                .attr('stroke-width', 1 + 3 * Math.pow(d.weight, 1.5))
                .attr('stroke-opacity', 0.5 + 0.5 * Math.pow(d.importance, 0.8));
            });

        // 创建节点组并绑定数据
        const node = chart.append('g')
            .attr('class', 'nodes')  // 节点组class
            .selectAll('g')
            .data(graph.nodes)
            .enter()  // 只处理新数据(性能优化)
            .append('g')  // 每个节点一个group(包含圆形和文本)
            .attr('class', 'node-container')
            .attr('visibility', 'visible');  // 初始可见

        // 为每个节点添加圆形元素
        node.append('circle')
            .attr('class', 'node')
            // 半径公式：3 + sqrt(frequency)*0.2 
            // - 确保最小半径3px，与频率平方根成正比
            .attr('r', d => 3 + Math.sqrt(d.frequency) * 0.2)
            .attr('fill', defaultNodeColor)
            .attr('cursor', 'pointer')  // 鼠标悬停指针样式
            // 添加拖拽行为
            .call(d3.drag()
                .on('start', dragstarted)  // 拖拽开始
                .on('drag', dragged)       // 拖拽中
                .on('end', dragended))    // 拖拽结束
            // 点击事件：切换关键词选择器
            .on('click', d => selectors.toggleSelector('keywords', d.id))
            // 鼠标悬停事件：高亮关联节点
            .on('mouseover', d => {
                // 高亮当前节点
                const highlightedNodeContainer = chart.selectAll('.node-container')
                    .filter(d2 => d2.id === d.id)
                    .classed('highlighted', true);
                highlightedNodeContainer
                    .selectAll('.node')
                    .attr('fill', highlightedNodeColor);
                highlightedNodeContainer
                    .selectAll('text')
                    .attr('font-weight', 'bold');
                
                // 收集关联节点ID
                const includeSelectedNode = [];  // 直接关联节点
                const adjacentToSelectedNode = []; // 所有关联节点
                
                // 隐藏非关联边
                chart.selectAll('.link')
                    .filter(d2 => {
                        if (d2.source.id != d.id && d2.target.id != d.id) return true;
                        if (d2.source.id === d.id) {
                            includeSelectedNode.push(d2.target.id);
                            adjacentToSelectedNode.push(d2.target.id)
                        } else {
                            adjacentToSelectedNode.push(d2.source.id)
                        }
                        return false;
                    })
                    .attr('visibility', 'hidden');
                
                // 高亮直接关联节点
                chart.selectAll('.node')
                    .filter(d2 => includeSelectedNode.indexOf(d2.id) >= 0)
                    .attr('fill', highlightedNodeColor2);
                
                // 隐藏非关联节点
                chart.selectAll('.node-container')
                    .filter(d2 => adjacentToSelectedNode.indexOf(d2.id) < 0 && d2.id != d.id)
                    .attr('visibility', 'hidden');
                
                updateLabelVisibility();
            })
            // 鼠标移出事件：恢复默认显示
            .on('mouseout', () => {
                chart.selectAll('.node-container')
                    .attr('visibility', 'visible')  // 显示所有节点
                    .classed('highlighted', false); // 移除高亮class
                chart.selectAll('.node')
                    .attr('fill', defaultNodeColor); // 恢复默认颜色
                chart.selectAll('.node-container text')
                    .attr('font-weight', 'normal');  // 恢复文本粗细
                chart.selectAll('.link')
                    .attr('visibility', 'visible'); // 显示所有边
                updateLabelVisibility();  // 更新标签可见性
            });

        // 为每个节点添加文本标签
        node.append('text')
            .text(d => d.id)  // 显示关键词ID
            .attr('pointer-events', 'none')  // 禁用文本的鼠标事件
            // 文本位置偏移：基于节点半径
            .attr('x', d => 6 + Math.sqrt(d.frequency) * 0.2)
            .attr('y', d => 3 + Math.sqrt(d.frequency) * 0.2);

        network.simulation
            .nodes(graph.nodes)
            .on('tick', ticked);

        network.simulation.force('link')
            .links(graph.links);

        updateLabelVisibility();

        /**
         * 力导向布局的tick事件处理函数
         * 每帧更新节点和边的位置
         */
        function ticked() {
            link.attr('d', linkArc);
            node.attr('transform', d => `translate(${d.x},${d.y})`);
        }

        /**
         * 节点拖拽开始事件处理
         * @param {Object} d - 被拖拽的节点数据
         */
        function dragstarted(d) {
            if (!d3.event.active) network.simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }

        /**
         * 节点拖拽过程事件处理
         * @param {Object} d - 被拖拽的节点数据
         */
        function dragged(d) {
            d.fx = d3.event.x;
            d.fy = d3.event.y;
        }

        /**
         * 节点拖拽结束事件处理
         * @param {Object} d - 被拖拽的节点数据
         */
        function dragended(d) {
            if (!d3.event.active) network.simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }

        /**
         * 生成边路径的圆弧
         * @param {Object} d - 边数据对象
         * @returns {string} SVG路径描述字符串
         */
        function linkArc(d) {
            const r = Math.hypot(d.target.x - d.source.x, d.target.y - d.source.y);
            return `
              M${d.source.x},${d.source.y}
              A${r},${r} 0 0,1 ${d.target.x},${d.target.y}
            `;
        }

        /**
         * 动态更新标签可见性
         * 
         * 算法说明：
         * 1. 收集所有可见节点的相对重要性值
         * 2. 按降序排序
         * 3. 自适应计算显示标签数量：
         *    nLabelsAdapted = floor(nLabels * (minRatio + (1-minRatio)*visibleNodes/totalNodes))
         * 4. 设置显示阈值：第nLabelsAdapted个节点的相对重要性值
         * 5. 只显示相对重要性高于阈值的标签
         * 6. 高亮节点的标签始终显示
         * 
         * 参数说明：
         * - nLabels: 基准标签数量(15)
         * - minLabelsRatio: 最小显示比例(0.2)
         */
        function updateLabelVisibility() {
            let relativeImportanceOfVisible = [];
            chart.selectAll('.node-container[visibility = "visible"]').each(d => relativeImportanceOfVisible.push(d.relativeImportance));
            relativeImportanceOfVisible = relativeImportanceOfVisible.sort((a, b) => b - a);
            const nLabelsAdapted = Math.floor(nLabels * (minLabelsRatio + (1 - minLabelsRatio) * relativeImportanceOfVisible.length / graph.nodes.length));
            const relativeImportanceLabelingThreshold = relativeImportanceOfVisible.length > nLabelsAdapted ? relativeImportanceOfVisible[nLabelsAdapted] : 0.0;
            node.selectAll('text')
                .attr('visibility', d => d.relativeImportance > relativeImportanceLabelingThreshold ? 'inherit' : 'hidden');
            node.filter(d => d.relativeImportance > relativeImportanceLabelingThreshold)
                .raise();
            chart.selectAll('.node-container.highlighted')
                .raise()
                .selectAll('text')
                .attr('visibility', 'visible');
        }
    }

})();
