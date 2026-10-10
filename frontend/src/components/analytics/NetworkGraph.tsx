import { useEffect, useRef, useState } from 'react';
import { DataSet, Network } from 'vis-network/standalone';

import { useTheme } from '../../contexts/ThemeContext';
import { resolveBrandColor } from '../../lib/design';
import type { NetworkNode, NetworkEdge } from '../../types/vis-network';

interface NetworkGraphProps {
    data: {
        userId: string;
        username: string;
        channelId?: string;
        channel?: string;
        suspicionScore?: number;
        ghostScore?: number;
        interactions?: number;
    }[];
    height?: number;
}

function NetworkGraph({ data, height = 500 }: NetworkGraphProps) {
    const { effectiveTheme } = useTheme();
    const containerRef = useRef<HTMLDivElement>(null);
    const networkRef = useRef<Network | null>(null);
    const [selectedNode, setSelectedNode] = useState<string | null>(null);

    useEffect(() => {
        if (!containerRef.current || data.length === 0) return;

        // Create nodes and edges from data
        const nodes: NetworkNode[] = [];
        const edges: NetworkEdge[] = [];
        const processedUsers = new Set<string>();
        const processedChannels = new Set<string>();

        data.forEach((item) => {
            // Add user node
            if (!processedUsers.has(item.userId)) {
                nodes.push({
                    id: `user-${item.userId}`,
                    label: item.username || 'Unknown',
                    group: 'user',
                    value: (item.suspicionScore || 0) + (item.ghostScore || 0),
                    title: `${item.username}\nSuspicion: ${item.suspicionScore || 0}\nGhost: ${item.ghostScore || 0}`,
                });
                processedUsers.add(item.userId);
            }

            // Add channel node if present
            if (
                item.channelId &&
                item.channel &&
                !processedChannels.has(item.channelId)
            ) {
                nodes.push({
                    id: `channel-${item.channelId}`,
                    label:
                        item.channel.length > 20
                            ? item.channel.substring(0, 20) + '...'
                            : item.channel,
                    group: 'channel',
                    value: 10,
                    title: item.channel,
                });
                processedChannels.add(item.channelId);
            }

            // Add edge between user and channel
            if (item.channelId) {
                edges.push({
                    from: `user-${item.userId}`,
                    to: `channel-${item.channelId}`,
                    value: item.interactions || 1,
                    title: `${item.interactions || 1} interactions`,
                });
            }
        });

        // Create datasets
        const nodesDataSet = new DataSet<NetworkNode>(nodes);
        const edgesDataSet = new DataSet<NetworkEdge>(edges);

        // Network options
        const options = {
            nodes: {
                shape: 'dot',
                scaling: {
                    min: 10,
                    max: 30,
                },
                font: {
                    size: 12,
                    color: resolveBrandColor('ink'),
                },
            },
            edges: {
                width: 0.15,
                color: { inherit: 'from' },
                smooth: {
                    enabled: true,
                    type: 'continuous',
                    roundness: 0.5,
                },
            },
            groups: {
                user: {
                    color: {
                        background: resolveBrandColor('accent'),
                        border: resolveBrandColor('accent'),
                        highlight: {
                            background: resolveBrandColor('accent'),
                            border: resolveBrandColor('accent'),
                        },
                    },
                },
                channel: {
                    color: {
                        background: resolveBrandColor('success'),
                        border: resolveBrandColor('success'),
                        highlight: {
                            background: resolveBrandColor('success'),
                            border: resolveBrandColor('accent'),
                        },
                    },
                },
            },
            physics: {
                stabilization: { iterations: 200 },
                barnesHut: {
                    gravitationalConstant: -2000,
                    springConstant: 0.001,
                    springLength: 200,
                },
            },
            interaction: {
                hover: true,
                tooltipDelay: 100,
            },
        };

        const network = new Network(
            containerRef.current,
            { nodes: nodesDataSet, edges: edgesDataSet },
            options
        );

        networkRef.current = network;

        // Add click listener
        network.on('click', (params) => {
            if (params.nodes.length > 0) {
                setSelectedNode(params.nodes[0]);
            } else {
                setSelectedNode(null);
            }
        });

        // Cleanup
        return () => {
            network.destroy();
        };
    }, [data, effectiveTheme]);

    if (data.length === 0) {
        return (
            <div
                className="bl-empty flex items-center justify-center"
                style={{ height: `${height}px` }}
            >
                <p className="text-bl-muted">No network data available</p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <div
                ref={containerRef}
                className="bg-bl-recessed rounded"
                style={{ height: `${height}px` }}
            />
            {selectedNode && (
                <div className="bl-hint p-2 bg-bl-recessed rounded">
                    Selected: {selectedNode}
                </div>
            )}
        </div>
    );
}

export default NetworkGraph;
