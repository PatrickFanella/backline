import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import type { SankeyExtraProperties, SankeyLink, SankeyNode } from 'd3-sankey';
import { useEffect, useRef } from 'react';

import { chartColors } from '../../lib/design';

interface SankeyNodeData extends SankeyExtraProperties {
    name: string;
    category?: 'channel' | 'user';
}

interface SankeyLinkData extends SankeyExtraProperties {
    source: number;
    target: number;
    value: number;
}

interface SankeyData {
    nodes: SankeyNodeData[];
    links: SankeyLinkData[];
}

type LayoutNode = SankeyNode<SankeyNodeData, SankeyLinkData>;
type LayoutLink = SankeyLink<SankeyNodeData, SankeyLinkData>;

function getLayoutNode(endpoint: LayoutLink['source']): LayoutNode | null {
    return typeof endpoint === 'object' && endpoint !== null ? endpoint : null;
}

function nodeName(endpoint: LayoutLink['source']): string {
    return getLayoutNode(endpoint)?.name ?? 'Unknown';
}

interface SankeyDiagramProps {
    data: {
        userId: string;
        username: string;
        channelId?: string;
        channel?: string;
        count?: number;
        suspicionScore?: number;
    }[];
    width?: number;
    height?: number;
}

function SankeyDiagram({
    data,
    width = 800,
    height = 500,
}: SankeyDiagramProps) {
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        if (!svgRef.current || data.length === 0) return;

        // Clear previous content
        d3.select(svgRef.current).selectAll('*').remove();

        // Prepare Sankey data
        const nodes: SankeyNodeData[] = [];
        const links: SankeyLinkData[] = [];
        const nodeMap = new Map<string, number>();

        // Create nodes for users and channels
        data.forEach((item) => {
            const userId = `user-${item.userId}`;
            const channelId = item.channelId
                ? `channel-${item.channelId}`
                : null;

            // Add user node
            if (!nodeMap.has(userId)) {
                nodeMap.set(userId, nodes.length);
                nodes.push({
                    name: item.username || 'Unknown',
                    category: 'user',
                });
            }

            // Add channel node
            if (channelId && item.channel && !nodeMap.has(channelId)) {
                nodeMap.set(channelId, nodes.length);
                nodes.push({ name: item.channel, category: 'channel' });
            }

            // Add link
            if (channelId) {
                links.push({
                    source: nodeMap.get(userId)!,
                    target: nodeMap.get(channelId)!,
                    value: item.count || 1,
                });
            }
        });

        const sankeyData: SankeyData = { nodes, links };

        // Set up dimensions
        const margin = { top: 10, right: 10, bottom: 10, left: 10 };
        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;

        // Create SVG
        const svg = d3
            .select(svgRef.current)
            .attr('width', width)
            .attr('height', height)
            .append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Create Sankey generator
        const sankeyGenerator = sankey<
            SankeyData,
            SankeyNodeData,
            SankeyLinkData
        >()
            .nodeWidth(15)
            .nodePadding(10)
            .extent([
                [0, 0],
                [innerWidth, innerHeight],
            ]);

        // Generate Sankey layout
        const { nodes: sankeyNodes, links: sankeyLinks } =
            sankeyGenerator(sankeyData);

        // Color scale
        const colorScale = d3
            .scaleOrdinal<string>()
            .domain(['user', 'channel'])
            .range([chartColors.accent, chartColors.success]);

        // Draw links
        svg.append('g')
            .attr('class', 'links')
            .selectAll('path')
            .data(sankeyLinks)
            .join('path')
            .attr('d', sankeyLinkHorizontal<SankeyNodeData, SankeyLinkData>())
            .attr('stroke', (d) =>
                colorScale(getLayoutNode(d.source)?.category ?? 'user')
            )
            .attr('stroke-width', (d) => Math.max(1, d.width ?? 0))
            .attr('fill', 'none')
            .attr('opacity', 0.5)
            .append('title')
            .text(
                (d) =>
                    `${nodeName(d.source)} → ${nodeName(d.target)}\n${d.value} interactions`
            );

        // Draw nodes
        const node = svg
            .append('g')
            .attr('class', 'nodes')
            .selectAll('rect')
            .data(sankeyNodes)
            .join('rect')
            .attr('x', (d) => d.x0 ?? 0)
            .attr('y', (d) => d.y0 ?? 0)
            .attr('height', (d) => (d.y1 ?? 0) - (d.y0 ?? 0))
            .attr('width', (d) => (d.x1 ?? 0) - (d.x0 ?? 0))
            .attr('fill', (d) => colorScale(d.category ?? 'user'))
            .attr('stroke', chartColors.canvas)
            .attr('stroke-width', 1);

        // Add node labels
        svg.append('g')
            .attr('class', 'labels')
            .selectAll('text')
            .data(sankeyNodes)
            .join('text')
            .attr('x', (d) =>
                (d.x0 ?? 0) < innerWidth / 2 ? (d.x1 ?? 0) + 6 : (d.x0 ?? 0) - 6
            )
            .attr('y', (d) => ((d.y1 ?? 0) + (d.y0 ?? 0)) / 2)
            .attr('dy', '0.35em')
            .attr('text-anchor', (d) =>
                (d.x0 ?? 0) < innerWidth / 2 ? 'start' : 'end'
            )
            .attr('font-size', '10px')
            .attr('fill', chartColors.ink)
            .text((d) =>
                d.name.length > 15 ? d.name.substring(0, 15) + '...' : d.name
            );

        // Add tooltips
        node.append('title').text(
            (d) => `${d.name}\n${d.value ?? 0} total interactions`
        );
    }, [data, width, height]);

    if (data.length === 0) {
        return (
            <div
                className="bl-empty flex items-center justify-center"
                style={{ width: `${width}px`, height: `${height}px` }}
            >
                <p className="text-bl-muted">No flow data available</p>
            </div>
        );
    }

    return (
        <div className="overflow-auto bg-bl-recessed rounded p-4">
            <svg ref={svgRef} />
        </div>
    );
}

export default SankeyDiagram;
