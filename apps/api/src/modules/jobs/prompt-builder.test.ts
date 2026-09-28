import assert from 'node:assert/strict';
import { it } from 'node:test';
import { detectImageIntent, type ImageJobCreateRequest } from '@picup/shared';
import { buildFinalPrompt } from './prompt-builder';

const base: ImageJobCreateRequest = { mode: 'edit', provider: 'auto', model: 'auto', template: 'freeform', prompt: '', imageIds: ['a'], quality: '1K', aspectRatio: 'auto' };
const build = (input: Partial<ImageJobCreateRequest>, prompt = '把杯子换成红色') => buildFinalPrompt({ input: { ...base, ...input, prompt }, prompt });

it('detects edit intents without matching negations or adjustments', () => {
  assert.equal(detectImageIntent('把背景换成海边', true), 'replace_background');
  assert.equal(detectImageIntent('去掉左边的路人', true), 'remove_object');
  assert.equal(detectImageIntent('把标题改成“夏日特惠”', true), 'replace_text');
  assert.equal(detectImageIntent('加一只猫在沙发上', true), 'add_object');
  assert.equal(detectImageIntent('修复这张老照片', true), 'enhance');
  assert.equal(detectImageIntent('不要改变颜色，稍微提亮', true), 'freeform');
  assert.equal(detectImageIntent('增加亮度', true), 'freeform');
});

it('only applies creative intents when there is no source image', () => {
  assert.equal(detectImageIntent('做一张奶茶店开业海报', false), 'poster_text');
  assert.equal(detectImageIntent('去掉背景里的人', false), 'freeform');
  assert.equal(detectImageIntent('一只水彩风格的狐狸', false), 'style');
});

it('keeps edit-only rules out of generation prompts', () => {
  const final = build({ mode: 'generate', imageIds: [], template: 'remove_object' }, '一只橘猫坐在窗台');
  assert.match(final, /生成一张全新的图片/);
  assert.doesNotMatch(final, /消除|参考图|alpha/);
  assert.doesNotMatch(final, /棋盘格/);
  assert.match(build({ mode: 'generate', imageIds: [] }, '透明背景的图标'), /不要画棋盘格/);
});

it('describes image numbering and the base image for multi-image edits', () => {
  const final = build({ imageIds: ['a', 'b', 'c'] }, '把图片 2（人物）放进图片 1（背景）');
  assert.match(final, /共 3 张参考图/);
  assert.match(final, /以图片 1 作为主画面/);
  assert.match(final, /图片 2（人物）/);
  assert.match(build({}), /以图片 1 为唯一的画面基准/);
  assert.match(build({ aspectRatio: '16:9' }), /输出为 16:9 比例/);
  assert.match(build({ width: 1536, height: 1024 }), /1536×1024 像素/);
  assert.match(build({ template: 'replace_text' }), /逐字准确/);
});

it('omits the placeholder label when a preview edit has no user text', () => {
  const final = build({ previewOperation: 'background' }, '去除背景');
  assert.doesNotMatch(final, /【用户要求】/);
  assert.match(final, /真实透明的 PNG/);
  assert.doesNotMatch(final, /【任务】\n- 按用户指令/);
  const comment = build({ previewOperation: 'comment', guideFileId: 'g', editComments: [{ x: 10, y: 20, text: ' 换成蓝色 ' }, { x: 0, y: 0, text: ' ' }] }, '评论编辑');
  assert.match(comment, /标记 1（横向 10.0%，纵向 20.0%）：换成蓝色/);
  assert.doesNotMatch(comment, /标记 2/);
});

it('appends deduplicated subject notes', () => {
  const final = buildFinalPrompt({ input: { ...base, prompt: 'x' }, prompt: 'x', subjectNotes: ['图片 1 的主体描述：白色上衣', '图片 1 的主体描述：白色上衣'] });
  assert.equal(final.match(/白色上衣/g)?.length, 1);
});
