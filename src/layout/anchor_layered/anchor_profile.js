import {PhaseError,freezeRecord,compareIds} from './protocol.js';
import {inputDigest} from './input_digest.js';
import {structuralOrderingKey} from './structural_ordering_key.js';
import {orderLayers} from './p3_ordering.js';
import {createGroupSweepContext} from './group_sweep.js';
import {selectOrderGroupCandidate} from './order_group_candidates.js';
import {ORDER_GROUP_POLICY} from './order_group_contract.js';

export const ANCHOR_PROFILE_VERSION = '1.0.0';
export const H08_PROFILE_VERSION = ANCHOR_PROFILE_VERSION;

export function normalizeAnchorProfile(input, entries = [], profileName = 'anchor') {
  if (!Array.isArray(entries)) throw new PhaseError('p0','invalid-order-groups');
  const nodes = new Set(input.nodes.map(node => node.id)), seen = new Set();
  const groups = entries.map(entry => {
    if (!entry || typeof entry.nodeId !== 'string' || typeof entry.membershipKey !== 'string'
      || !nodes.has(entry.nodeId) || seen.has(entry.nodeId)) throw new PhaseError('p0','invalid-order-group');
    seen.add(entry.nodeId);
    return {nodeId:entry.nodeId,membershipKey:entry.membershipKey};
  }).sort((a,b)=>compareIds(a.nodeId,b.nodeId));
  const id = profileName === 'h08' ? 'h08' : 'anchor';
  const profile = {id,version:ANCHOR_PROFILE_VERSION,...ORDER_GROUP_POLICY,
    structuralOrdering:true,implicitEndpoints:true,physicalAnchors:true,groups};
  return freezeRecord({...profile,digest:inputDigest(JSON.stringify(profile))});
}

export const normalizeH08Profile = (input, entries = []) => normalizeAnchorProfile(input, entries, 'h08');

export function withStructuralOrdering(graph) {
  return freezeRecord({...graph,orderingDigest:structuralOrderingKey(graph)});
}

export function orderAnchorLayers(input, options, profile) {
  const phaseOptions = {...options,orderingDigest:input.orderingDigest};
  const baseline = orderLayers(input,phaseOptions), members = new Set(input.nodes.map(node=>node.id));
  const groups = profile.groups.filter(entry=>members.has(entry.nodeId));
  if (!groups.length) return baseline;
  const groupContext = createGroupSweepContext(input,groups);
  const sweep = orderLayers(input,{...phaseOptions,groupContext,layoutUnits:true});
  return selectOrderGroupCandidate(baseline,groups,{extraCandidates:[{policy:'unit-sweep',graph:sweep}]});
}

export const orderH08Layers = orderAnchorLayers;
