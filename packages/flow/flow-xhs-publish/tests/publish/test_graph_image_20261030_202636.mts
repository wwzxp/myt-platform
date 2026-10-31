import { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { AdbDeviceControl } from '../../../../device/device-adb/src/index.ts'
import { loadFlowGraph } from '../../../../automation/automation/src/graph/load.ts'
import { runXhsGraph } from '../../src/graph-runtime.ts'
import { readdirSync } from 'node:fs'

const dir='C:/Users/Administrator/Desktop/测试合并版本/static/东东飞超/黑色背景3_4-1080_1440'
const images=readdirSync(dir).filter(f=>f.endsWith('.png')).sort((a,b)=>parseInt(a)-parseInt(b)).slice(0,2).map(f=>`${dir}/${f}`)

const ctx=new Context()
const device=new AdbDeviceControl(ctx,{adbPath:'F:/ai/myt_tools/packages/app/desktop/dist/win-unpacked/resources/tools/adb.exe'})
const serial='127.0.0.1:5565'
// 图来自工作流库；配置在 globalVariable 里
const raw=JSON.parse(await readFile('F:/ai/myt_tools/data/workflows/发布图文笔记.json','utf8'))
const cfg=raw.globalVariable?.properties
const graph=await loadFlowGraph({ ...raw, data:{ app: cfg?.app?.default, maxSteps: cfg?.maxSteps?.default } })
console.log(`图 ${graph.id}：${graph.nodes.length} 节点 / ${graph.edges.length} 边`)

const model=Object.assign(async(prompt:string)=>{
  const r=await fetch('http://127.0.0.1:11434/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({model:'minicpm46',messages:[{role:'user',content:prompt}],max_tokens:64,temperature:0,reasoning_effort:'none',response_format:{type:'json_object'}})})
  const d=await r.json() as any
  return (d.choices?.[0]?.message?.content??'').trim()
},{
  __vision:async(prompt:string,png:Buffer)=>{
    const r=await fetch('http://127.0.0.1:11434/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({model:'minicpm46',messages:[{role:'user',content:[
        {type:'text',text:prompt},
        {type:'image_url',image_url:{url:`data:image/png;base64,${png.toString('base64')}`}}]}],
        max_tokens:120,temperature:0,reasoning_effort:'none'})})
    const d=await r.json() as any
    return (d.choices?.[0]?.message?.content??'').trim()
  }
})

const sctx:any={
  serial,deviceId:'dev',runId:'graph',device,
  runs:{stepSucceeded:()=>{}},
  yadbPath:'F:/ai/myt_tools/packages/app/desktop/dist/win-unpacked/resources/tools/yadb',
  random:{next:Math.random,int:(a:number,b:number)=>a+Math.floor(Math.random()*(b-a+1))},
  humanPolicy:{},
  flowParams:{
    imagePaths: images.join(','),
    title:'自动化测试标题',
    body:'这是一条自动化测试笔记正文',
    topics:'测试,自动化',
    musicImg:'',
    fbMode:'save',
  },
  throwIfCancelled:()=>{},
  snapshot:async()=>await device.dumpUi(serial,{channel:'yadb'}),
  model,
}
const outcome=await runXhsGraph(sctx,graph)
console.log(`\n结果 ok=${outcome.ok} 耗时=${(outcome.ms/1000).toFixed(1)}s`)
console.log('轨迹:')
for(const t of outcome.trail){
  console.log(`  ${t.node.padEnd(24)} → ${(t.port??'-').padEnd(9)} ${t.ms}ms`)
}
if(!outcome.ok) console.log(`\n失败于 ${outcome.failedAt}: ${outcome.reason}`)
process.exit(0)
