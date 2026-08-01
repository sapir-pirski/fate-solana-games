type Attributes=Record<string,string|number|boolean|undefined|null>;
type Registry={counters:Map<string,number>;sums:Map<string,number>;counts:Map<string,number>};
const globalRegistry=globalThis as typeof globalThis&{__fateTelemetry?:Registry};
const registry=globalRegistry.__fateTelemetry??={counters:new Map(),sums:new Map(),counts:new Map()};
const forbidden=/wallet|signature|token|secret|private|signed|authorization|cookie|operation.?id|ip|error.?message/i;
const clean=(attributes:Attributes)=>Object.fromEntries(Object.entries(attributes).filter(([key,value])=>!forbidden.test(key)&&value!==undefined&&value!==null).map(([key,value])=>[key,String(value).slice(0,120)]));
const labels=(attributes:Attributes)=>{const values=clean(attributes);const keys=Object.keys(values).sort();return keys.length?`{${keys.map(key=>`${key}="${values[key]!.replaceAll("\\","\\\\").replaceAll('"','\\"')}"`).join(",")}}`:"";};
const metricKey=(name:string,attributes:Attributes)=>`${name}${labels(attributes)}`;
export function increment(name:string,attributes:Attributes={},value=1){const key=metricKey(name,attributes);registry.counters.set(key,(registry.counters.get(key)??0)+value);}
export function observe(name:string,value:number,attributes:Attributes={}){const key=metricKey(name,attributes);registry.sums.set(key,(registry.sums.get(key)??0)+value);registry.counts.set(key,(registry.counts.get(key)??0)+1);}
const suffix=(key:string,value:string)=>key.includes("{")?key.replace("{",`${value}{`):`${key}${value}`;
export function renderMetrics(){const lines:string[]=[];for(const [key,value] of registry.counters)lines.push(`${key} ${value}`);for(const [key,value] of registry.sums)lines.push(`${suffix(key,"_sum")} ${value}`);for(const [key,value] of registry.counts)lines.push(`${suffix(key,"_count")} ${value}`);return lines.join("\n");}
export function jsonLog(level:"debug"|"info"|"warn"|"error",event:string,message:string,attributes:Attributes={}){console[level==="debug"?"log":level](JSON.stringify({timestamp:new Date().toISOString(),level,event,message,service:process.env.OTEL_SERVICE_NAME??"fate-platform",environment:process.env.NODE_ENV??"development",version:process.env.APP_REVISION??"local",...clean(attributes),schemaVersion:1}));}
const hex=(size:number)=>Array.from(crypto.getRandomValues(new Uint8Array(size)),byte=>byte.toString(16).padStart(2,"0")).join("");
function parentContext(traceparent?:string|null){const match=traceparent?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i);return match?{traceId:match[1],parentSpanId:match[2]}:{traceId:hex(16),parentSpanId:undefined};}
async function exportSpan(span:Record<string,unknown>){const endpoint=process.env.OTEL_EXPORTER_OTLP_ENDPOINT;if(!endpoint)return;const body={resourceSpans:[{resource:{attributes:[{key:"service.name",value:{stringValue:process.env.OTEL_SERVICE_NAME??"fate-platform"}},{key:"deployment.environment",value:{stringValue:process.env.NODE_ENV??"development"}}]},scopeSpans:[{scope:{name:"fate.telemetry",version:"1"},spans:[span]}]}]};await fetch(`${endpoint.replace(/\/$/,"")}/v1/traces`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(1500)}).catch(()=>undefined);}
export async function withSpan<T>(name:string,attributes:Attributes,operation:()=>Promise<T>,traceparent?:string|null){
  const parent=parentContext(traceparent),spanId=hex(8),start=Date.now(),startNs=String(BigInt(Date.now())*1_000_000n);
  try{
    const result=await operation(),duration=Date.now()-start;
    observe("fate_span_duration_ms",duration,{span:name,status:"ok"});jsonLog("info","span_complete",name,{...attributes,durationMs:duration,traceId:parent.traceId,spanId});
    await Promise.race([exportSpan({traceId:parent.traceId,spanId,parentSpanId:parent.parentSpanId,name,startTimeUnixNano:startNs,endTimeUnixNano:String(BigInt(Date.now())*1_000_000n),attributes:Object.entries(clean(attributes)).map(([key,value])=>({key,value:{stringValue:value}})),status:{code:1}}),new Promise(resolve=>setTimeout(resolve,20))]);
    return result;
  }catch(error){
    const duration=Date.now()-start;increment("fate_errors_total",{component:String(attributes.component??"unknown"),code:error instanceof Error?error.name:"unknown"});jsonLog("error","span_failed",name,{...attributes,durationMs:duration,errorCode:error instanceof Error?error.name:"unknown",traceId:parent.traceId,spanId});
    await Promise.race([exportSpan({traceId:parent.traceId,spanId,parentSpanId:parent.parentSpanId,name,startTimeUnixNano:startNs,endTimeUnixNano:String(BigInt(Date.now())*1_000_000n),status:{code:2,message:error instanceof Error?error.name:"unknown"}}),new Promise(resolve=>setTimeout(resolve,20))]);throw error;
  }
}
