import { ArrowRight, BarChart3, CheckCircle2, GitBranch, Presentation, ShieldAlert, Workflow, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { gateDecisions, scenarios } from './data';
import type { Scenario, ScenarioStatus, WorkstreamStatus } from './types';
import './styles.css';

const statusLabels: Record<ScenarioStatus, string> = {
  explore: 'Explore',
  review: 'In review',
  promoted: 'Promoted',
  dropped: 'Dropped'
};

const workstreamLabels: Record<WorkstreamStatus, string> = {
  complete: 'Complete',
  'at-risk': 'At risk',
  blocked: 'Blocked',
  'not-started': 'Not started'
};

const formatMoney = (value: number): string => `£${value.toLocaleString('en-GB')}m`;
const formatLcoe = (value: number): string => `£${value}/MWh`;

function App() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(scenarios[0].id);
  const [statusFilter, setStatusFilter] = useState<ScenarioStatus | 'all'>('all');
  const [leadershipMode, setLeadershipMode] = useState(false);

  const selectedScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? scenarios[0];
  const filteredScenarios = scenarios.filter((scenario) => statusFilter === 'all' || scenario.status === statusFilter);

  const portfolio = useMemo(() => {
    const active = scenarios.filter((scenario) => scenario.status !== 'dropped');
    return {
      activeCount: active.length,
      promotedCount: scenarios.filter((scenario) => scenario.status === 'promoted').length,
      averageLcoe: Math.round(active.reduce((total, scenario) => total + scenario.lcoe, 0) / active.length),
      bestIrr: Math.max(...active.map((scenario) => scenario.irr)),
      blockedHandoffs: scenarios.flatMap((scenario) => scenario.workstreams).filter((stream) => stream.status === 'blocked' || stream.status === 'at-risk').length
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Wind Farm Development Control Room</p>
          <h1>Manage scenario branches, engineering handoffs, and leadership decisions in one place.</h1>
          <p className="hero-copy">
            This working prototype assumes the specialist tools already exist. It focuses on the orchestration layer: scenario branching, handoff confidence, gate decisions, and an executive-ready recommendation pack.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => setLeadershipMode(!leadershipMode)}>
              <Presentation size={18} /> {leadershipMode ? 'Exit leadership mode' : 'Open leadership mode'}
            </button>
            <button className="secondary-button" onClick={() => setSelectedScenarioId('s2')}>
              <GitBranch size={18} /> Review 18 MW upside
            </button>
          </div>
        </div>
        <div className="score-card featured">
          <span>Recommended scenario</span>
          <strong>{scenarios.find((scenario) => scenario.status === 'promoted')?.name}</strong>
          <p>{selectedScenario.summary}</p>
        </div>
      </section>

      <section className="metric-grid" aria-label="Portfolio summary metrics">
        <Metric title="Active branches" value={portfolio.activeCount.toString()} detail="excluding dropped options" />
        <Metric title="Promoted" value={portfolio.promotedCount.toString()} detail="ready for leadership" />
        <Metric title="Avg. LCoE" value={formatLcoe(portfolio.averageLcoe)} detail="active scenario set" />
        <Metric title="Best IRR" value={`${portfolio.bestIrr}%`} detail="current upside case" />
        <Metric title="Handoff risks" value={portfolio.blockedHandoffs.toString()} detail="blocked or at-risk packs" warning />
      </section>

      {leadershipMode ? (
        <LeadershipPack selectedScenario={selectedScenario} />
      ) : (
        <div className="workspace-grid">
          <ScenarioExplorer
            filteredScenarios={filteredScenarios}
            selectedScenarioId={selectedScenarioId}
            statusFilter={statusFilter}
            onSelect={setSelectedScenarioId}
            onFilter={setStatusFilter}
          />
          <ScenarioDetail scenario={selectedScenario} />
          <HandoffMap scenario={selectedScenario} />
        </div>
      )}
    </main>
  );
}

function Metric({ title, value, detail, warning = false }: { title: string; value: string; detail: string; warning?: boolean }) {
  return (
    <article className={`metric-card ${warning ? 'warning' : ''}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ScenarioExplorer({ filteredScenarios, selectedScenarioId, statusFilter, onSelect, onFilter }: {
  filteredScenarios: Scenario[];
  selectedScenarioId: string;
  statusFilter: ScenarioStatus | 'all';
  onSelect: (scenarioId: string) => void;
  onFilter: (status: ScenarioStatus | 'all') => void;
}) {
  const filters: Array<ScenarioStatus | 'all'> = ['all', 'explore', 'review', 'promoted', 'dropped'];

  return (
    <section className="panel scenario-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Scenario tree</p>
          <h2>Branch, compare, prune</h2>
        </div>
        <GitBranch className="panel-icon" />
      </div>
      <div className="filter-row">
        {filters.map((filter) => (
          <button key={filter} className={statusFilter === filter ? 'filter active' : 'filter'} onClick={() => onFilter(filter)}>
            {filter === 'all' ? 'All' : statusLabels[filter]}
          </button>
        ))}
      </div>
      <div className="scenario-list">
        {filteredScenarios.map((scenario) => (
          <button key={scenario.id} className={selectedScenarioId === scenario.id ? 'scenario-card selected' : 'scenario-card'} onClick={() => onSelect(scenario.id)}>
            <div className="scenario-card-top">
              <span className={`badge ${scenario.status}`}>{statusLabels[scenario.status]}</span>
              <span className="score">Gate {scenario.gateScore}</span>
            </div>
            <strong>{scenario.name}</strong>
            <small>Parent: {scenario.parent}</small>
            <div className="mini-metrics">
              <span>{scenario.capacityMw} MW</span>
              <span>{formatLcoe(scenario.lcoe)}</span>
              <span>{scenario.irr}% IRR</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ScenarioDetail({ scenario }: { scenario: Scenario }) {
  const decision = gateDecisions.find((item) => item.scenarioId === scenario.id);

  return (
    <section className="panel detail-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Selected branch</p>
          <h2>{scenario.name}</h2>
        </div>
        <BarChart3 className="panel-icon" />
      </div>
      <p className="scenario-summary">{scenario.summary}</p>
      <div className="comparison-grid">
        <Metric title="Turbine" value={scenario.turbine} detail={scenario.foundation} />
        <Metric title="Net AEP" value={`${scenario.netAepGwh.toLocaleString('en-GB')} GWh`} detail={`${scenario.capacityMw} MW installed`} />
        <Metric title="CAPEX" value={formatMoney(scenario.capexM)} detail={`OPEX ${formatMoney(scenario.opexM)}/yr`} />
        <Metric title="LCoE" value={formatLcoe(scenario.lcoe)} detail={`${scenario.irr}% project IRR`} />
      </div>
      <div className="risk-row">
        <div>
          <span>Risk burn-down</span>
          <div className="progress"><span style={{ width: `${100 - scenario.risk}%` }} /></div>
        </div>
        <strong>{100 - scenario.risk}% resolved</strong>
      </div>
      <div className="decision-card">
        {decision?.decision === 'Promote' ? <CheckCircle2 /> : decision?.decision === 'Drop' ? <XCircle /> : <ShieldAlert />}
        <div>
          <span>Gate recommendation: {decision?.decision}</span>
          <p>{decision?.reason}</p>
        </div>
      </div>
    </section>
  );
}

function HandoffMap({ scenario }: { scenario: Scenario }) {
  return (
    <section className="panel handoff-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Digital handoffs</p>
          <h2>Workstream readiness</h2>
        </div>
        <Workflow className="panel-icon" />
      </div>
      <div className="handoff-list">
        {scenario.workstreams.map((stream) => (
          <article className="handoff-card" key={stream.id}>
            <div className="handoff-main">
              <span className={`status-dot ${stream.status}`} />
              <div>
                <strong>{stream.name}</strong>
                <small>{stream.owner} · {stream.dataPack}</small>
              </div>
            </div>
            <div className="handoff-meta">
              <span className={`badge ${stream.status}`}>{workstreamLabels[stream.status]}</span>
              <span>{stream.confidence}% confidence</span>
              <span>{stream.openActions} actions</span>
            </div>
            <div className="handoff-flow">
              <span>{stream.nextMilestone}</span>
              <ArrowRight size={16} />
              <strong>{stream.handoffTo}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function LeadershipPack({ selectedScenario }: { selectedScenario: Scenario }) {
  const promoted = scenarios.find((scenario) => scenario.status === 'promoted') ?? selectedScenario;
  const contenders = scenarios.filter((scenario) => scenario.status !== 'dropped').sort((a, b) => b.gateScore - a.gateScore);

  return (
    <section className="leadership-pack">
      <div className="panel leadership-hero">
        <p className="eyebrow">Leadership recommendation</p>
        <h2>Promote {promoted.name} and preserve one upside branch for targeted risk burn-down.</h2>
        <p>
          The control room converts workstream outputs into a decision narrative: what changed, what is ready, what is blocked, and which scenario should receive the next tranche of engineering effort.
        </p>
      </div>
      <div className="panel ranking-panel">
        <h3>Scenario ranking</h3>
        {contenders.map((scenario, index) => (
          <div className="ranking-row" key={scenario.id}>
            <span>#{index + 1}</span>
            <strong>{scenario.name}</strong>
            <small>{formatLcoe(scenario.lcoe)} · {scenario.irr}% IRR · risk {scenario.risk}/100</small>
            <div className="progress"><span style={{ width: `${scenario.gateScore}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="panel narrative-panel">
        <h3>Board-pack storyline</h3>
        <ol>
          <li>Confirm the base case as the investable project configuration for the next gate.</li>
          <li>Fund a two-week jacket supply-chain and fabrication sprint for the 18 MW upside case.</li>
          <li>Archive low-return and high-risk options while retaining the assumptions for audit traceability.</li>
          <li>Lock handoff owners and data-pack dates so finance always reflects the latest engineering baseline.</li>
        </ol>
      </div>
    </section>
  );
}

export default App;
