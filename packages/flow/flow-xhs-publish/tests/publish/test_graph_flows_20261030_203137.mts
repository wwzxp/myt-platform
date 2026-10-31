import { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { AdbDeviceControl } from '../../../../device/device-adb/src/index.ts'
import { loadFlowGraph } from '../../../../automation/automation/src/graph/load.ts'
import { runXhsGraph } from '../../src/graph-runtime.ts'

const ctx=new Context()
const device=new AdbDeviceControl(ctx,{adbPath:'F:/ai/myt_tools/packages/app/desktop/dist/win-unpacked/resources/tools/adb.exe'})
const serial='127.0.0.1:5565'
const model=Object.assign(async(prompt:string)=>{
  const r=await fetch('http://127.0.0.1:11434/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({model:'minicpm46',messages:[{role:'user',content:prompt}],max_tokens:64,temperature:0,reasoning_effort:'none',response_format:{type:'json_object'}})})
  const d=await r.json() as any
  return (d.choices?.[0]?.message?.content??'').trim()
},{__vision:async(prompt:string,png:Buffer)=>{
  const r=await fetch('http://127.0.0.1:11434/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({model:'minicpm46',messages:[{role:'user',content:[
      {type:'text',text:prompt},{type:'image_url',image_url:{url:`data:image/png;base64,${png.toString('base64')}`}}]}],
      max_tokens:120,temperature:0,reasoning_effort:'none'})})
  const d=await r.json() as any
  return (d.choices?.[0]?.message?.content??'').trim()
}})

/**
 * 真机跑图。
 *
 * 图来自**工作流库**（`data/workflows/`），配置（app/maxSteps）在图的
 * `globalVariable` 里——与画布保存的格式一致，不再有第二份数据源。
 *
 * 用法：`npx tsx <本文件> 发布文字笔记`
 */
const name=process.argv[2]!
const params:Record<string,string> = name==='发布文字笔记'
  ? { title:'文字笔记测试标题', body:'这是一条自动化测试的文字笔记正文', topics:'测试,自动化', textContent:'文字笔记的文字内容', fbMode:'save' }
  : { title:'长文笔记测试标题', body:'这是一条自动化测试的长文笔记正文，内容要长一些。', topics:'测试,自动化', fbMode:'save' }

const raw=JSON.parse(await readFile(`F:/ai/myt_tools/data/workflows/${name}.json`,'utf8'))
// 把 globalVariable 里的 default 提到顶层 data（引擎需要的形态）
const cfg=raw.globalVariable?.properties
const graph=await loadFlowGraph({
  ...raw,
  data:{ app: cfg?.app?.default, maxSteps: cfg?.maxSteps?.default },
})
console.log(`图 ${graph.id}：${graph.nodes.length} 节点 / ${graph.edges.length} 边`)
const sctx:any={
  serial,deviceId:'dev',runId:'graph',device,runs:{stepSucceeded:()=>{}},
  yadbPath:'F:/ai/myt_tools/packages/app/desktop/dist/win-unpacked/resources/tools/yadb',
  random:{next:Math.random,int:(a:number,b:number)=>a+Math.floor(Math.random()*(b-a+1))},
  humanPolicy:{},flowParams:params,throwIfCancelled:()=>{},
  snapshot:async()=>await device.dumpUi(serial,{channel:'yadb'}),model,
}
const outcome=await runXhsGraph(sctx,graph)
console.log(`结果 ok=${outcome.ok} 耗时=${(outcome.ms/1000).toFixed(1)}s`)
for(const t of outcome.trail) console.log(`  ${t.node.padEnd(22)} → ${(t.port??'-').padEnd(9)} ${t.ms}ms`)
if(!outcome.ok) console.log(`失败于 ${outcome.failedAt}: ${outcome.reason}`)
process.exit(0)
