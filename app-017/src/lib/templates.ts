/**
 * 本地模板库：通知、课本页、练习卡、菜单（需求文档 §4.6）。
 */

export interface BrailleTemplate {
  id: string;
  name: string;
  description: string;
  raw: string;
}

export const TEMPLATES: BrailleTemplate[] = [
  {
    id: 'notice',
    name: '通知',
    description: '学校/机构通用通知格式',
    raw: `通知

各位家长：

本校定于下周五下午两点，在报告厅召开特殊教育工作会，请准时参加。

特教学校教务处
9月20日`,
  },
  {
    id: 'textbook',
    name: '课本页',
    description: '课文段落排版示例（分页阅读）',
    raw: `秋天到了，天气凉了。一片片黄叶从树上落下来，好像一只只飞舞的蝴蝶。

一群大雁往南飞，一会儿排成个人字，一会儿排成个一字。

啊，秋天来了！`,
  },
  {
    id: 'practice',
    name: '练习卡',
    description: '拼音与数字练习（多音字确认示例）',
    raw: `一、读出下面的音节：ba ba ma ma bo fo

二、写出下面的数字：12 35 406

三、多音字练习：长大 长城 音乐 快乐`,
  },
  {
    id: 'menu',
    name: '菜单',
    description: '食堂/餐厅无障碍菜单',
    raw: `今日菜单

早餐：豆浆、油条、鸡蛋、小米粥
午餐：红烧肉、清炒时蔬、番茄蛋汤、米饭
晚餐：牛肉面、凉拌黄瓜、紫菜汤

价格：早餐5元，午餐18元，晚餐15元`,
  },
];
