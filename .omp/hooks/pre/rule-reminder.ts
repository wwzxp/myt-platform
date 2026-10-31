import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

export default function hook(pi: HookAPI): void {
  const checklist = `
【项目规范提醒】以上仅为精简摘要，完整规范在 rule://project-rules

执行前必读：
0. 新增/修改文件 → 先确认放置位置和命名（含时间戳规则）           [§0]
1. 同步更新相关文档、注释；重要决策调用 retain 保存               [§1]
2. 编写前先读 CONTEXT.md（术语）+ STYLE.md（风格）+ 涉及代码文件  [§2]
3. 新增/修改/删除文件 → 更新 INDEX.md 对应章节                    [§3]
4. 文件只能编辑不能重写，编辑前必须先读文件定位改动点             [§4]
5. 任务完成后输出改动清单表格 + 完成核对清单                      [§5]
6. 浏览器一律走 ego；验证完立刻关页 task.finish({ keep: [] })        [§9]

⚠️ 重要：以上是摘要，不是完整规则。
只要对任何一条规则的具体内容有哪怕一丝不确定，不要猜测、不要假设你已经知道——
立即执行：read → rule://project-rules，读完再动手。
需要查阅历史决策 → 调用 recall
`.trim();

  pi.on("before_agent_start", async () => {
    return {
      message: {
        customType: "rule-reminder",
        display: true,    // 确认生效后可改为 false
        content: checklist,
      },
    };
  });
}
