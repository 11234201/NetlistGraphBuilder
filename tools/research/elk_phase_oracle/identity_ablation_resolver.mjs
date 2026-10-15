export function createIdentityAblationResolver({legacyP2=false,legacyP5=false,legacyTree=false}={}){
  const replacements=new Map();
  if(legacyP2)replacements.set(new URL('../../../src/layout/elk_native/network_simplex.js',import.meta.url).href,
    new URL('../../../tests/reference/elk_native/p2_simplex_identity_baseline.js',import.meta.url).href);
  if(legacyP5)replacements.set(new URL('../../../src/layout/elk_native/routing_dependencies.js',import.meta.url).href,
    new URL('../../../tests/reference/elk_native/p5_dependency_order_baseline.js',import.meta.url).href);
  if(legacyTree)replacements.set(new URL('../../../src/layout/netTreeRouter.js',import.meta.url).href,
    new URL('../../../tests/reference/elk_native/net_tree_before_indexed_trace.js',import.meta.url).href);
  return (specifier,context,nextResolve)=>{
    const resolved=nextResolve(specifier,context),replacement=replacements.get(resolved.url);
    return replacement?nextResolve(replacement,context):resolved;
  };
}
