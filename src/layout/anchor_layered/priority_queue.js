export class PriorityQueue {
  constructor(compare) { this.compare=compare; this.items=[]; }
  push(value) {
    const items=this.items; items.push(value); let index=items.length-1;
    while(index>0) { const parent=(index-1)>>>1;
      if(this.compare(items[parent],value)<=0)break;
      items[index]=items[parent];index=parent;
    }
    items[index]=value;
  }
  pop() {
    if(!this.items.length)return undefined;
    const first=this.items[0],last=this.items.pop();
    if(this.items.length) {
      let index=0;
      while(index*2+1<this.items.length) {
        let child=index*2+1;
        if(child+1<this.items.length&&this.compare(this.items[child+1],this.items[child])<0)child++;
        if(this.compare(last,this.items[child])<=0)break;
        this.items[index]=this.items[child];index=child;
      }
      this.items[index]=last;
    }
    return first;
  }
  get size() { return this.items.length; }
}
