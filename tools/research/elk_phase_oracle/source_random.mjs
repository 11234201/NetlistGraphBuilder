// Independently expressed Java Random 48-bit recurrence for research controls.
export class SourceRandom{
  constructor(seed){this.SetSeed(seed);}
  SetSeed(seed){this.state=(BigInt(seed)^0x5deece66dn)&((1n<<48n)-1n);}
  Next(bits){this.state=(this.state*0x5deece66dn+11n)&((1n<<48n)-1n);return Number(this.state>>BigInt(48-bits));}
  NextBoolean(){return this.Next(1)!==0;}
  NextFloat(){return this.Next(24)/2**24;}
  NextDouble(){return (this.Next(26)*2**27+this.Next(27))/2**53;}
  NextLong(){return BigInt.asIntN(64,(BigInt.asIntN(32,BigInt(this.Next(32)))<<32n)+BigInt.asIntN(32,BigInt(this.Next(32))));}
}
export function createSourceRandom(seed){
  const generator=new SourceRandom(seed),derivedSeed=generator.NextLong();
  const model=generator.NextBoolean()?'node_relative':'layer_total';
  generator.SetSeed(derivedSeed);
  const random=()=>generator.NextFloat();
  Object.assign(random,{double:()=>generator.NextDouble(),boolean:()=>generator.NextBoolean(),model,
    researchKey:`explicit:${seed}:derived:${derivedSeed}`});
  return random;
}
