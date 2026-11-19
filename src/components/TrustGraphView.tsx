import { useMemo, useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import type { ComputedProjectTrust, NetworkSnapshot } from '../types/api.ts';

interface TrustGraphViewProps {
  snapshot: NetworkSnapshot;
  onUpdateTrustEdge: (sourceProjectId: string, targetProjectId: string, weight: number) => Promise<void>;
}

export function TrustGraphView({ snapshot, onUpdateTrustEdge }: TrustGraphViewProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ghostty');
  const [saving, setSaving] = useState(false);

  const trustById = useMemo(
    () => new Map<string, ComputedProjectTrust>(snapshot.projectTrust.map((t) => [t.projectId, t])),
    [snapshot.projectTrust]
  );

  const observerNode = snapshot.projects.find((p) => p.id === snapshot.observerProjectId);

  // Lay out nodes cleanly by hop distance & category in an SVG coordinate space (960 x 520)
  const layoutNodes = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; tier: string }>();

    const hop0 = snapshot.projects.filter((p) => p.id === snapshot.observerProjectId);
    const hop1 = snapshot.projects.filter((p) => {
      const t = trustById.get(p.id);
      return t && t.hops === 1 && !t.isSybilIsolated && !t.isFlaggedHostile;
    });
    const hostiles = snapshot.projects.filter((p) => {
      const t = trustById.get(p.id);
      return t && t.isFlaggedHostile && !t.isSybilIsolated;
    });
    const hop2Plus = snapshot.projects.filter((p) => {
      const t = trustById.get(p.id);
      return t && !t.isSybilIsolated && !t.isFlaggedHostile && (t.hops >= 2 || (t.hops === -1 && !p.isHostile));
    });
    const sybils = snapshot.projects.filter((p) => trustById.get(p.id)?.isSybilIsolated);

    hop0.forEach((p) => positions.set(p.id, { x: 110, y: 250, tier: 'Observer' }));

    hop1.forEach((p, i) => {
      const step = 420 / Math.max(1, hop1.length + 1);
      positions.set(p.id, { x: 320, y: 50 + step * (i + 1), tier: '1-Hop Direct' });
    });

    hop2Plus.forEach((p, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const totalRows = Math.ceil(hop2Plus.length / 2);
      const stepY = 440 / Math.max(1, totalRows + 1);
      positions.set(p.id, {
        x: 540 + col * 140,
        y: 40 + stepY * (row + 1),
        tier: 'Transitive Peer',
      });
    });

    // Hostile projects get their own quarantine zone (top-right, amber region)
    hostiles.forEach((p, i) => {
      const step = 120 / Math.max(1, hostiles.length + 1);
      positions.set(p.id, {
        x: 855,
        y: 60 + step * (i + 1),
        tier: 'Hostile Damped',
      });
    });

    sybils.forEach((p, i) => {
      const angle = (i / Math.max(1, sybils.length)) * Math.PI * 2;
      positions.set(p.id, {
        x: 855 + Math.cos(angle) * 58,
        y: 380 + Math.sin(angle) * 58,
        tier: 'Isolated Sybil Ring',
      });
    });

    return positions;
  }, [snapshot.projects, snapshot.observerProjectId, trustById]);

  const selectedNode =
    snapshot.projects.find((p) => p.id === selectedProjectId) ?? snapshot.projects[0];
  const selectedTrust = selectedNode ? trustById.get(selectedNode.id) : undefined;
  const directEdgeFromObserver = observerNode?.trustEdges.find(
    (e) => e.targetProjectId === selectedNode?.id
  );
  const [draftWeight, setDraftWeight] = useState<number>(directEdgeFromObserver?.weight ?? 0);

  const handleSelectNode = (projectId: string) => {
    setSelectedProjectId(projectId);
    const edge = observerNode?.trustEdges.find((e) => e.targetProjectId === projectId);
    setDraftWeight(edge?.weight ?? 0);
  };

  const handleSaveWeight = async (newWeight: number) => {
    if (!selectedNode || selectedNode.id === snapshot.observerProjectId) return;
    setSaving(true);
    try {
      await onUpdateTrustEdge(snapshot.observerProjectId, selectedNode.id, newWeight);
      setDraftWeight(newWeight);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* SVG Network Graph */}
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Personalized Web-of-Trust Topology ({snapshot.projects.length} Projects)
              </h3>
              <p className="text-xs text-slate-500">
                Click any project node to inspect hop-decayed trust, hostile damping, or adjust your direct edge weight.
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600" /> Observer
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> Trusted
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-600" /> Hostile Damped
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600" /> Sybil Ring (0.00)
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <svg
              viewBox="0 0 960 500"
              className="w-full h-auto min-w-[700px] bg-slate-50/70 rounded-md border border-slate-100"
            >
              {/* Zone labels */}
              <text x="110" y="26" textAnchor="middle" className="fill-slate-400 text-[11px] font-medium">
                Observer Seed
              </text>
              <text x="320" y="26" textAnchor="middle" className="fill-slate-400 text-[11px] font-medium">
                1-Hop Direct Peers
              </text>
              <text x="610" y="26" textAnchor="middle" className="fill-slate-400 text-[11px] font-medium">
                Transitive Network (Hop-Decayed)
              </text>

              {/* Sybil ring enclosure */}
              <rect
                x="765"
                y="290"
                width="180"
                height="185"
                rx="10"
                className="fill-red-50/50 stroke-red-200"
                strokeDasharray="4 4"
              />
              <text x="855" y="308" textAnchor="middle" className="fill-red-700 text-[10px] font-semibold">
                Isolated Sybil Clique (0 Trust)
              </text>

              {/* Hostile project quarantine zone */}
              <rect
                x="800"
                y="30"
                width="145"
                height="150"
                rx="8"
                className="fill-amber-50/50 stroke-amber-300"
                strokeDasharray="4 4"
              />
              <text x="873" y="47" textAnchor="middle" className="fill-amber-700 text-[10px] font-semibold">
                Hostile Damped (0.15×)
              </text>

              {/* Directed Trust Edges */}
              {snapshot.projects.map((src) =>
                src.trustEdges.map((edge) => {
                  const p1 = layoutNodes.get(src.id);
                  const p2 = layoutNodes.get(edge.targetProjectId);
                  if (!p1 || !p2) return null;
                  const isSybilEdge = Boolean(src.isSybilCluster);
                  const isObserverEdge = src.id === snapshot.observerProjectId;
                  return (
                    <line
                      key={`${src.id}-${edge.targetProjectId}`}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={
                        isSybilEdge
                          ? '#FCA5A5'
                          : isObserverEdge
                            ? '#2563EB'
                            : '#CBD5E1'
                      }
                      strokeWidth={isObserverEdge ? 2 : 1.25}
                      strokeOpacity={isObserverEdge ? 0.75 : 0.65}
                    />
                  );
                })
              )}

              {/* Project Nodes */}
              {snapshot.projects.map((proj) => {
                const pos = layoutNodes.get(proj.id);
                if (!pos) return null;
                const trust = trustById.get(proj.id);
                const isSelected = proj.id === selectedProjectId;
                const isObserver = proj.id === snapshot.observerProjectId;

                let fill = '#64748B';
                if (isObserver) fill = '#2563EB';
                else if (trust?.isSybilIsolated) fill = '#DC2626';
                else if (trust?.isFlaggedHostile) fill = '#D97706';
                else if ((trust?.effectiveTrust ?? 0) > 0.25) fill = '#16A34A';

                return (
                  <g
                    key={proj.id}
                    onClick={() => handleSelectNode(proj.id)}
                    className="cursor-pointer"
                  >
                    {isSelected && (
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={19}
                        fill="none"
                        stroke="#0F172A"
                        strokeWidth={2}
                      />
                    )}
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={isObserver ? 14 : 11}
                      fill={fill}
                      stroke="#FFFFFF"
                      strokeWidth={2}
                    />
                    <text
                      x={pos.x}
                      y={pos.y + 23}
                      textAnchor="middle"
                      className="fill-slate-800 text-[10px] font-medium pointer-events-none"
                    >
                      {proj.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Selected Node Inspector */}
        <div className="xl:col-span-4 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          {selectedNode && selectedTrust && (
            <>
              <div className="border-b border-slate-200 pb-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-base font-semibold text-slate-900">{selectedNode.name}</h4>
                  {selectedTrust.isSybilIsolated ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
                      <ShieldOff className="w-3.5 h-3.5" /> Sybil Isolated
                    </span>
                  ) : selectedTrust.isFlaggedHostile ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                      <ShieldAlert className="w-3.5 h-3.5" /> Hostile Damped
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                      <ShieldCheck className="w-3.5 h-3.5" /> Reachable Peer
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  {selectedNode.repo} · {selectedNode.ecosystem} · @{selectedNode.maintainer}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 bg-slate-50 rounded border border-slate-200/80">
                  <div className="text-slate-500">Effective Trust</div>
                  <div className="mt-0.5 text-lg font-semibold font-mono tabular-nums text-slate-900">
                    {selectedTrust.effectiveTrust.toFixed(2)}
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded border border-slate-200/80">
                  <div className="text-slate-500">Shortest Hop Path</div>
                  <div className="mt-0.5 text-lg font-semibold font-mono tabular-nums text-slate-900">
                    {selectedTrust.hops >= 0 ? `${selectedTrust.hops} hop(s)` : 'Unreachable'}
                  </div>
                </div>
              </div>

              {selectedTrust.bestPath.length > 0 && (
                <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200/70">
                  <span className="font-medium text-slate-700">Propagation path: </span>
                  {selectedTrust.bestPath.join(' → ')}
                </div>
              )}

              {selectedTrust.isSybilIsolated && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200/70 rounded p-2.5">
                  This project belongs to an isolated clique with zero inbound trust edges from any established seed project. All mutual vouches from this ring are assigned 0.00 weight.
                </p>
              )}

              {selectedTrust.isFlaggedHostile && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200/70 rounded p-2.5">
                  Anomalous denounce ratio detected ({selectedNode.denouncedCountBase} denouncements vs {selectedNode.vouchedCountBase} vouches). Weight is automatically damped to 0.15x and requires multi-project corroboration before flagging any contributor.
                </p>
              )}

              {selectedNode.id !== snapshot.observerProjectId && (
                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">
                      Direct Trust from {observerNode?.name}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      {draftWeight.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={draftWeight}
                    onChange={(e) => setDraftWeight(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      disabled={saving}
                      onClick={() => handleSaveWeight(draftWeight)}
                      className="flex-1 py-1.5 px-3 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
                    >
                      Apply Trust Weight
                    </button>
                    {draftWeight > 0 && (
                      <button
                        disabled={saving}
                        onClick={() => handleSaveWeight(0)}
                        className="py-1.5 px-3 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors disabled:opacity-50"
                      >
                        Sever Trust
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
