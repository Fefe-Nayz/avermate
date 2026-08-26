"use client"

import { useMemo } from "react"
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useExtracted } from "next-intl"
import { layoutMindmap, type MindmapContentV1 } from "./mindmap-model"

type MindmapFlowNode = Node<{ label: string; note?: string }, "studio-mindmap">

function MindmapFlowNodeView({ data }: NodeProps<MindmapFlowNode>) {
  return (
    <div className="w-[190px] rounded-xl border bg-card px-3 py-2.5 text-card-foreground shadow-xs">
      <Handle
        type="target"
        position={Position.Left}
        aria-hidden="true"
        className="pointer-events-none opacity-0"
      />
      <p className="text-sm leading-tight font-semibold">{data.label}</p>
      {data.note ? (
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
          {data.note}
        </p>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        aria-hidden="true"
        className="pointer-events-none opacity-0"
      />
    </div>
  )
}

const NODE_TYPES = { "studio-mindmap": MindmapFlowNodeView }

export function MindmapCanvas({ content }: { content: MindmapContentV1 }) {
  const t = useExtracted()
  const layout = useMemo(() => layoutMindmap(content), [content])
  const nodes = useMemo<MindmapFlowNode[]>(
    () =>
      layout.nodes.map((node) => ({
        id: node.id,
        position: { x: node.x, y: node.y },
        type: "studio-mindmap",
        data: { label: node.label, note: node.note },
        draggable: false,
        connectable: false,
        deletable: false,
        ariaLabel: node.note
          ? t("{label}. Note: {note}", {
              label: node.label,
              note: node.note,
            })
          : node.label,
        style: { width: 190 },
      })),
    [layout.nodes, t]
  )
  const edges = useMemo<Edge[]>(() => {
    const labelById = new Map(layout.nodes.map((node) => [node.id, node.label]))
    return layout.edges.map((edge) => ({
      ...edge,
      type: "smoothstep",
      focusable: false,
      selectable: false,
      deletable: false,
      markerEnd: { type: MarkerType.ArrowClosed },
      ariaLabel: t("Connection from {source} to {target}", {
        source: labelById.get(edge.source) ?? edge.source,
        target: labelById.get(edge.target) ?? edge.target,
      }),
    }))
  }, [layout.edges, layout.nodes, t])

  return (
    <ReactFlow
      aria-label={t("Mind map visual overview")}
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.2, minZoom: 0.2, maxZoom: 1 }}
      minZoom={0.15}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      edgesReconnectable={false}
      elementsSelectable={false}
      disableKeyboardA11y
      ariaLabelConfig={{
        "controls.ariaLabel": t("Mind map controls"),
        "controls.zoomIn.ariaLabel": t("Zoom in"),
        "controls.zoomOut.ariaLabel": t("Zoom out"),
        "controls.fitView.ariaLabel": t("Fit mind map to view"),
      }}
      panOnDrag
      panOnScroll
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
      className="bg-muted/20"
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
