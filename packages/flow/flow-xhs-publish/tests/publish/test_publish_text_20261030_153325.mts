import { Context } from '@deepseek-ai/cordis'
import { PageRegistry } from '../../../../automation/automation/src/index.ts'
import { XHS_PAGES as XHS_PAGES_REG, XHS_RECOVERY_RULES as XHS_RULES_REG } from '../../src/pages.ts'
import { AdbDeviceControl } from '../../../../device/device-adb/src/index.ts'
import { createPublishTextFlow } from '../../src/flows/publish-text.ts'

const ctx=new Context()
const device=new AdbDeviceControl(ctx,{adbPath:'F:/ai/myt_tools/packages/app/desktop/dist/win-unpacked/resources/tools/adb.exe'})
const serial='127.0.0.1:5565'
const flow=createPublishTextFlow({
  title:'文字笔记测试标题',
  body:'这是一条自动化测试的文字笔记正文',
  topics:['测试','自动化'],
  textContent:'文字笔记的文字内容',
  fbMode:'save',
})
console.log(`流程 ${flow.id} 共 ${flow.steps.length} 步`)
const runId='smoke'
const runs={stepSucceeded:()=>{}} as any
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
for(const step of flow.steps){
  const t0=Date.now()
  const sctx:any={
    serial,deviceId:'dev',runId,device,runs,yadbPath:'F:/ai/myt_tools/packages/app/desktop/dist/win-unpacked/resources/tools/yadb',
    random:{next:Math.random,int:(a:number,b:number)=>a+Math.floor(Math.random()*(b-a+1))},
    humanPolicy:{},flowParams:{},throwIfCancelled:()=>{},
    snapshot:async()=>await device.dumpUi(serial,{channel:'yadb'}),
    tapTarget:async()=>{},findTarget:async()=>({x:0,y:0,matchedBy:''}),model,
    app:{packageName:'com.xingin.xhs',homeUri:'xhsdiscover://home',pages:new PageRegistry().register(XHS_PAGES_REG),recoveryRules:XHS_RULES_REG},
  }
  try{ await step.run(sctx); console.log(`  ✓ ${step.id} (${Date.now()-t0}ms)`) }
  catch(e:any){ console.log(`  ✗ ${step.id} (${Date.now()-t0}ms): ${e.message}`); break }
}
process.exit(0)
