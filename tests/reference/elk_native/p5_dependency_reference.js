// Exact bounded test-only ELK pair semantics. Never imported by browser production code.
export function referenceDependencies(segments, criticalThreshold, edgeSpacing) {
  if (segments.length > 128) throw new Error('bounded P5 reference: at most 128 segments');
  const result = [];
  const conflicts = (first, second) => {
    if (!first.length || !second.length) return 0;
    let left = 0, right = 0, count = 0;
    while (true) {
      const a = first[left], b = second[right];
      if (a > b-criticalThreshold && a < b+criticalThreshold) return -1;
      if (a > b-edgeSpacing*0.5 && a < b+edgeSpacing*0.5) count++;
      if (a <= b && left+1 < first.length) left++;
      else if (b <= a && right+1 < second.length) right++;
      else break;
    }
    return count;
  };
  const crossings = (coordinates, segment) => coordinates.filter((value) => value >= segment.start && value <= segment.end).length;
  const add = (source, target, type, weight) => result.push({ source: source.id, target: target.id, type, weight });
  for (let i=0; i<segments.length; i++) for (let j=i+1; j<segments.length; j++) {
    const a=segments[i], b=segments[j];
    if (Math.abs(a.start-a.end)<1e-3 || Math.abs(b.start-b.end)<1e-3) continue;
    const first=conflicts(a.outgoing,b.incoming), second=conflicts(b.outgoing,a.incoming);
    if (first === -1 || second === -1) {
      if (first === -1) add(b,a,'CRITICAL',1);
      if (second === -1) add(a,b,'CRITICAL',1);
    } else {
      const one=first+16*(crossings(a.outgoing,b)+crossings(b.incoming,a));
      const two=second+16*(crossings(b.outgoing,a)+crossings(a.incoming,b));
      if (one<two) add(a,b,'REGULAR',two-one);
      else if (one>two) add(b,a,'REGULAR',one-two);
      else if (one>0) { add(a,b,'REGULAR',0); add(b,a,'REGULAR',0); }
    }
  }
  return result;
}
