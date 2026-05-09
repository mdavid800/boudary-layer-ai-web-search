import type { GateDecision, Scenario, Workstream } from './types';

const baseWorkstreams: Workstream[] = [
  {
    id: 'yield',
    name: 'Energy Yield',
    owner: 'Aisha Patel',
    status: 'complete',
    confidence: 92,
    handoffTo: 'Financial Model',
    nextMilestone: 'Wake-loss sign-off',
    openActions: 1,
    dataPack: 'P50/P90 AEP, wake losses, curtailment assumptions'
  },
  {
    id: 'foundations',
    name: 'Foundations',
    owner: 'Mark Jensen',
    status: 'at-risk',
    confidence: 71,
    handoffTo: 'Electrical CAPEX',
    nextMilestone: 'Concept select memo',
    openActions: 4,
    dataPack: 'Soil risk, jacket/monopile mass, install method'
  },
  {
    id: 'electrical',
    name: 'Electrical CAPEX/OPEX',
    owner: 'Niamh Kelly',
    status: 'complete',
    confidence: 86,
    handoffTo: 'Financial Model',
    nextMilestone: 'Export cable freeze',
    openActions: 2,
    dataPack: 'Array/export cable route, OSS, loss assumptions'
  },
  {
    id: 'om',
    name: 'O&M Strategy',
    owner: 'Luca Moretti',
    status: 'complete',
    confidence: 81,
    handoffTo: 'Financial Model',
    nextMilestone: 'Vessel strategy review',
    openActions: 3,
    dataPack: 'Availability, access limits, service logistics, spares'
  },
  {
    id: 'finance',
    name: 'Financial Model',
    owner: 'Grace Williams',
    status: 'at-risk',
    confidence: 74,
    handoffTo: 'Leadership Pack',
    nextMilestone: 'Investment committee model lock',
    openActions: 5,
    dataPack: 'LCoE, IRR, NPV, sensitivities, funding assumptions'
  }
];

const withStatuses = (overrides: Partial<Workstream>[]): Workstream[] =>
  baseWorkstreams.map((stream) => ({
    ...stream,
    ...overrides.find((override) => override.id === stream.id)
  }));

export const scenarios: Scenario[] = [
  {
    id: 's1',
    name: 'Base Case: 15 MW monopile',
    parent: 'Origination brief',
    status: 'promoted',
    turbine: '15 MW class',
    foundation: 'XL monopile',
    capacityMw: 900,
    netAepGwh: 3978,
    capexM: 2810,
    opexM: 82,
    lcoe: 54,
    irr: 10.8,
    risk: 37,
    gateScore: 83,
    summary: 'Best balanced option with strong AEP, acceptable installation risk, and finance-ready assumptions.',
    workstreams: withStatuses([{ id: 'finance', status: 'complete', confidence: 88, openActions: 1 }])
  },
  {
    id: 's2',
    name: 'Upside: 18 MW jacket',
    parent: 's1',
    status: 'review',
    turbine: '18 MW class',
    foundation: 'Jacket',
    capacityMw: 1080,
    netAepGwh: 4895,
    capexM: 3360,
    opexM: 94,
    lcoe: 51,
    irr: 11.6,
    risk: 58,
    gateScore: 78,
    summary: 'Higher return potential, but foundation maturity and port constraints need a fast risk burn-down sprint.',
    workstreams: withStatuses([
      { id: 'foundations', status: 'blocked', confidence: 48, openActions: 7, nextMilestone: 'Fabrication capacity decision' },
      { id: 'finance', status: 'at-risk', confidence: 68, openActions: 4 }
    ])
  },
  {
    id: 's3',
    name: 'Conservative: 12 MW monopile',
    parent: 's1',
    status: 'explore',
    turbine: '12 MW class',
    foundation: 'Standard monopile',
    capacityMw: 720,
    netAepGwh: 3090,
    capexM: 2390,
    opexM: 76,
    lcoe: 61,
    irr: 8.9,
    risk: 24,
    gateScore: 62,
    summary: 'Lowest delivery risk, but falling behind target economics unless supply-chain discounts materialise.',
    workstreams: withStatuses([
      { id: 'yield', status: 'at-risk', confidence: 70, openActions: 3 },
      { id: 'finance', status: 'not-started', confidence: 35, openActions: 6 }
    ])
  },
  {
    id: 's4',
    name: 'Dropped: floating demonstrator',
    parent: 'Origination brief',
    status: 'dropped',
    turbine: '15 MW class',
    foundation: 'Floating semi-sub',
    capacityMw: 600,
    netAepGwh: 2540,
    capexM: 3250,
    opexM: 112,
    lcoe: 79,
    irr: 6.4,
    risk: 76,
    gateScore: 41,
    summary: 'Technology learning value noted, but economics and grid-date risk are not competitive for this project.',
    workstreams: withStatuses([
      { id: 'foundations', status: 'blocked', confidence: 42, openActions: 9 },
      { id: 'electrical', status: 'at-risk', confidence: 61, openActions: 5 },
      { id: 'finance', status: 'complete', confidence: 80, openActions: 0 }
    ])
  }
];

export const gateDecisions: GateDecision[] = [
  { scenarioId: 's1', decision: 'Promote', reason: 'Meets LCoE threshold, lowest unresolved handoff load, ready for leadership recommendation.' },
  { scenarioId: 's2', decision: 'Hold', reason: 'Potentially value accretive, but foundation blockers must close before gate promotion.' },
  { scenarioId: 's3', decision: 'Drop', reason: 'Keep as a contingency only; economics do not justify full workstream effort.' },
  { scenarioId: 's4', decision: 'Drop', reason: 'Too much capex and programme risk for the current bid window.' }
];
