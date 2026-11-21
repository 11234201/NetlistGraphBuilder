export function demand(value, code, message) {
  if (!value) throw Object.assign(new Error(message), {code});
  return value;
}

export function resultPage(values, page, pageSize = 100) {
  demand(Number.isSafeInteger(page) && page >= 1, "INVALID_ARGUMENT", "Expected a positive page number");
  const pages = Math.max(1, Math.ceil(values.length / pageSize));
  demand(page <= pages, "PAGE_OUT_OF_RANGE", "Report page is out of range");
  return {total:values.length, page, pages, entries:values.slice((page - 1) * pageSize, page * pageSize)};
}

export function resultSummary(item) {
  const {id, category, kind, rootId, stemId, mergeId} = item;
  return {id,category,kind,rootId,stemId,mergeId};
}

export function analysisStatus(state, scope, selected) {
  const {status,detailStatus,progress,data,error,detailError} = state;
  return {status,detailStatus,progress,scope,selected,error,detailError,
    reasons:[...new Set([...(data?.reasons || []), ...(data?.reconvergence?.reasons || []), ...(data?.blocks?.reasons || [])])],
    reconvergence:data?.reconvergence?.results.length || 0, blocks:data?.blocks?.results.length || 0};
}

export function pathItems(path) {
  return (path?.nodeIds || []).map((nodeId,index) => ({nodeId,edgeId:index ? path.edgeIds[index - 1] : null}));
}
