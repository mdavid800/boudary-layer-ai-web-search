export type ScenarioStatus = 'explore' | 'review' | 'promoted' | 'dropped';
export type WorkstreamStatus = 'complete' | 'at-risk' | 'blocked' | 'not-started';

export interface Workstream {
  id: string;
  name: string;
  owner: string;
  status: WorkstreamStatus;
  confidence: number;
  handoffTo: string;
  nextMilestone: string;
  openActions: number;
  dataPack: string;
}

export interface Scenario {
  id: string;
  name: string;
  parent: string;
  status: ScenarioStatus;
  turbine: string;
  foundation: string;
  capacityMw: number;
  netAepGwh: number;
  capexM: number;
  opexM: number;
  lcoe: number;
  irr: number;
  risk: number;
  gateScore: number;
  summary: string;
  workstreams: Workstream[];
}

export interface GateDecision {
  scenarioId: string;
  decision: 'Promote' | 'Drop' | 'Hold';
  reason: string;
}
