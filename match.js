/* 政策匹配：企业资料助理在对话里收集信息和资料，交接给政策匹配顾问，由其在对话里逐项解析、列出政策。只在已收录的官方公开政策内按用户所选内容筛选排序，没有实时检索；文件只记录名称，不读取内容。 */
(() => {
  'use strict';

  const questions = [
    { key: 'type', label: '企业类型', options: ['有限责任公司', '股份有限公司', '国有企业', '外商投资企业', '合伙企业', '个人独资企业'] },
    { key: 'stage', label: '成长阶段', options: ['初创期（创业）', '成长期（成长）', '成熟期（做大做强）'] },
    { key: 'revenue', label: '营业收入', options: ['500万以下', '500-2000万', '2000-5000万', '5000万-1亿', '1-2亿', '2-5亿', '5-10亿', '10亿以上'] },
    { key: 'rd', label: '研发费占营业收入比重', options: ['2%以下', '2%-3%', '3%-4%', '4%-5%', '5%-10%', '10%-15%', '15%以上'] },
    { key: 'talent', label: '近3年有无引进人才', options: ['无', '有'] },
  ];
  const groups = [
    { title: '基本信息', keys: ['type'] },
    { title: '经营情况', keys: ['stage', 'revenue'] },
    { title: '研发与人才', keys: ['rd', 'talent'] },
  ];
  const stageDelay = 1000;
  const state = { taskId: '', phase: 'result', stage: 0, timer: 0, drawerReturn: null };

  const S = () => window.PolicyStore;
  const esc = value => window.PolicyUI.escape(value);
  const icon = name => window.PolicyUI.icon(name);
  const labelOf = key => questions.find(question => question.key === key).label;
  const answersOf = task => task?.intake?.answers || {};
  const filesOf = task => task?.intake?.files || [];
  const answeredCount = answers => questions.filter(question => answers[question.key]).length;
  const revealedCount = answers => {
    const firstOpen = questions.findIndex(question => !answers[question.key]);
    return firstOpen < 0 ? questions.length : firstOpen + 1;
  };
  const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hintText = answers => {
    const left = questions.length - answeredCount(answers);
    return left ? `再选 ${left} 项，匹配更准` : '都选好了';
  };

  const publicPolicies = () => window.PolicyPublicPolicies || [];
  const pad = value => String(value).padStart(2, '0');
  const today = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; };
  const shortDate = value => `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日`;
  const statusOf = policy => (!policy.applicationEnd ? 'notice' : policy.applicationEnd < today() ? 'closed' : 'open');
  const daysLeft = policy => Math.round((Date.parse(policy.applicationEnd) - Date.parse(today())) / 86400000);

  function windowText(policy) {
    const status = statusOf(policy);
    if (status === 'notice') return '暂无统一申报窗口';
    if (status === 'closed') return `已于${shortDate(policy.applicationEnd)}截止`;
    if (policy.applicationStart > today()) return `${shortDate(policy.applicationStart)}开始申报`;
    const left = daysLeft(policy);
    return `${shortDate(policy.applicationEnd)}截止${left <= 7 ? `，${left ? `还剩 ${left} 天` : '今天截止'}` : ''}`;
  }

  /* 匹配依据只来自用户所选内容，不声称企业已满足政策条件。 */
  function matchPolicies(answers) {
    const { region, industry, stage, revenue, rd, talent } = answers;
    const rdLow = rd === '2%以下' || rd === '2%-3%';
    const inRegion = policy => !region || policy.region === '全国' || policy.region === region;
    const inIndustry = policy => !industry || industry === '其他行业' || policy.industries.includes(industry);
    const reasonsFor = policy => {
      const rules = [
        region && policy.region === region && [3, `面向${region}，和你选的地区一致`],
        region && policy.region === '全国' && [1, '全国范围的政策'],
        industry && policy.industries.includes(industry) && [2, `${industry}在这项政策涉及的行业内`],
      ];
      if (policy.supportType === '研发支持') rules.push(
        rd && !rdLow && [2, `研发费占比 ${rd}，和研发支持方向相符`],
        rd && rdLow && [0, `研发费占比 ${rd}，研发投入要重点核对`],
        talent === '有' && [1, '近3年引进过人才，可作为研发能力的佐证'],
      );
      if (policy.supportType === '资质培育') rules.push(
        stage && !stage.startsWith('成熟') && [1, `处于${stage.slice(0, 3)}，可以核对培育条件`],
        rd && !rdLow && [1, `研发费占比 ${rd}，可作为资质材料的基础`],
      );
      if (policy.supportType === '数字化改造') rules.push(
        revenue && revenue !== '500万以下' && [1, `营业收入 ${revenue}，有条件开展数字化项目`],
      );
      if (policy.supportType === '金融支持') rules.push(
        stage && [1, `处于${stage.slice(0, 3)}，可以了解对应的金融服务`],
      );
      return rules.filter(Boolean);
    };
    const order = { open: 0, notice: 1, closed: 2 };
    return publicPolicies()
      .filter(policy => inRegion(policy) && inIndustry(policy))
      .map((policy, index) => {
        const matched = reasonsFor(policy);
        return { policy, index, status: statusOf(policy), score: matched.reduce((sum, [points]) => sum + points, 0), reasons: matched.map(([, reason]) => reason) };
      })
      .sort((a, b) => order[a.status] - order[b.status] || b.score - a.score || a.index - b.index);
  }

  /* ---------- 画像出来前的理解过程：只整理用户已给的信息，没有外部查询 ---------- */
  const understand = { taskId: '', stage: 0, timer: 0 };
  const understanding = taskId => understand.taskId === taskId;

  function understandStages(task) {
    const answers = answersOf(task), files = filesOf(task).length;
    const row = (label, value) => `<div class="match-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
    const stages = [
      { title: '读取企业名称', rows: row('企业名称', task.company.name) },
      { title: '整理你提供的信息', rows: row('所在地区', answers.region || '未填写') + row('企业资料', files ? `${files} 份` : '未提供') },
      { title: '生成企业画像', rows: row('下一步', '补充几项情况，画像会更完整') },
    ];
    return `<ol class="match-stages" data-understand aria-live="polite">${stages.map((stage, index) => `<li class="match-stage" data-stage="${index}"${index > understand.stage ? ' hidden' : ''} data-state="${index === understand.stage ? 'active' : 'done'}"><div class="match-stage-head"><h4>${esc(stage.title)}</h4><span class="match-stage-status" aria-hidden="true"></span></div><div class="match-stage-rows"><div>${stage.rows}</div></div></li>`).join('')}</ol>`;
  }

  function understandTick() {
    if (understand.stage >= 2) {
      Object.assign(understand, { taskId: '', stage: 0, timer: 0 });
      window.PolicyUI.refresh();
      return;
    }
    understand.stage += 1;
    document.querySelectorAll('[data-understand] .match-stage').forEach(node => {
      const index = Number(node.dataset.stage);
      node.hidden = index > understand.stage;
      node.dataset.state = index === understand.stage ? 'active' : 'done';
    });
    understand.timer = window.setTimeout(understandTick, stageDelay);
  }

  function beginPortrait(taskId) {
    window.clearTimeout(understand.timer);
    if (reducedMotion()) return;
    Object.assign(understand, { taskId, stage: 0, timer: window.setTimeout(understandTick, stageDelay) });
  }

  function portraitLoading(task) {
    return `<section class="context-card workspace-summary is-understanding"><header class="context-card-heading"><h2>企业画像</h2><span>理解中</span></header>${understandStages(task)}</section>`;
  }

  /* ---------- 对话里的资料收集 ---------- */
  const intakeActive = task => Boolean(task?.intake) && task.intake.stage !== 'ready';

  function assistantBubble(text, card = '', role = 'match') {
    const person = window.PolicyPersonas.get(role);
    return `<div class="chat-message-row is-assistant"><span class="chat-message-avatar chat-message-expert-avatar" aria-hidden="true" style="--portrait-x:${person.x}%;--portrait-y:${person.y}%"></span><div class="chat-message-body intake-body"><span class="chat-message-name">${esc(person.name)}</span><p class="chat-message chat-assistant">${esc(text)}</p>${card}</div></div>`;
  }

  function userBubble(text) {
    return `<div class="chat-message-row is-user"><span class="chat-message-avatar chat-message-user-avatar" aria-hidden="true">企</span><div class="chat-message-body"><span class="chat-message-name">企业负责人</span><p class="chat-message chat-user">${esc(text)}</p></div></div>`;
  }

  function questionFields(answers, revealed = revealedCount(answers)) {
    return questions.map((question, index) => `<fieldset class="intake-question${index === revealed - 1 && index ? ' is-new' : ''}" data-question="${index}"${index < revealed ? '' : ' hidden'}><legend>${esc(question.label)}</legend><div class="match-options">${question.options.map(option => `<label class="match-option"><input type="radio" name="${question.key}" value="${esc(option)}"${answers[question.key] === option ? ' checked' : ''}><span>${esc(option)}</span></label>`).join('')}</div></fieldset>`).join('');
  }

  /* 所属行业只在对话的字段卡里问；选项来自已收录政策。 */
  function industryField(answers) {
    const options = [...new Set(publicPolicies().flatMap(policy => policy.industries)), '其他行业'];
    return `<fieldset class="intake-question"><legend>所属行业</legend><div class="match-options">${options.map(option => `<label class="match-option"><input type="radio" name="industry" value="${esc(option)}"${answers.industry === option ? ' checked' : ''}><span>${esc(option)}</span></label>`).join('')}</div></fieldset>`;
  }

  function fieldsCard(task) {
    const answers = answersOf(task), fields = industryField(answers) + questionFields(answers);
    return `<div class="intake-card intake-form" data-task="${esc(task.id)}"><div class="intake-name-row"><label for="intake-name">企业名称</label><input id="intake-name" type="text" maxlength="300" autocomplete="organization" data-task="${esc(task.id)}" value="${esc(task.company.name)}"></div>${fields}<div class="intake-foot"><p class="match-hint" aria-live="polite">${esc(hintText(answers))}</p><div class="intake-foot-actions"><button type="button" class="text-button" data-action="intake-start" data-task="${esc(task.id)}">跳过</button><button type="button" class="button button-primary" data-action="intake-start" data-task="${esc(task.id)}">确定 ${icon('arrow')}</button></div></div></div>`;
  }

  /* 输入框里的上传入口和已选文件，资料助理对话的任何阶段都能用。 */
  function composerAttach(task, showList = true) {
    const files = filesOf(task);
    const list = files.length && showList ? `<ul class="intake-files">${files.map(file => `<li><span>${esc(file.name)}</span><small>已上传</small><button type="button" class="text-button" data-action="intake-remove-file" data-task="${esc(task.id)}" data-file="${esc(file.id)}" aria-label="移除${esc(file.name)}">移除</button></li>`).join('')}</ul>` : '';
    return `${list}<label class="intake-attach" for="intake-files" title="上传资料"><input id="intake-files" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" data-task="${esc(task.id)}">${icon('clip')}<span class="sr-only">上传企业资料</span></label>`;
  }

  function answersSummary(answers) {
    return questions.filter(question => answers[question.key]).map(question => answers[question.key]).join(' · ') || '先不填，直接往下';
  }

  function intakeMarkup(task) {
    if (!task?.intake) return '';
    if (understanding(task.id)) return assistantBubble(`收到，我先理解一下「${task.company.name}」的情况。`, `<div class="intake-card match-running"><div class="match-running-body"><div class="match-orb" aria-hidden="true"><span class="match-orb-ring"></span><span class="match-orb-ring"></span><span class="match-orb-core">正在理解</span></div>${understandStages(task)}</div></div>`);
    const answers = answersOf(task), { stage } = task.intake;
    const greeting = `想帮「${task.company.name}」匹配政策，先了解几项情况，点选就行。`;
    if (stage === 'fields') return assistantBubble(greeting, fieldsCard(task));
    const edit = `<button type="button" class="text-button intake-edit" data-action="intake-edit" data-task="${esc(task.id)}">修改</button>`;
    const history = `${assistantBubble(greeting)}${userBubble(answersSummary(answers))}${edit}`;
    const count = filesOf(task).length;
    return `${history}${count ? userBubble(`选了 ${count} 份企业资料`) : ''}${assistantBubble('结果可以随时回看。想补充信息或资料，点上面的修改。', `<div class="intake-foot intake-ready"><button type="button" class="button button-primary" data-task="${esc(task.id)}" data-action="intake-result">查看匹配结果 ${icon('arrow')}</button></div>`)}`;
  }

  /* ---------- 按所选政策生成准备清单 ---------- */
  function applicationPatch(task, policy) {
    const sources = [...task.sources];
    const statusOf_ = sourceId => sources.find(source => source.id === sourceId)?.provided ? 'ready' : 'missing';
    const items = policy?.application?.checklist;
    if (items) {
      // 资格条件不进材料清单：在政策解读里提示，不拦截。
      const requirements = items.filter(item => item.kind !== 'condition').map(item => {
        const id = `${policy.id}-${item.id}`;
        if (!sources.some(source => source.id === id)) sources.push({ id, name: item.label, type: 'document', text: '', provided: false });
        return { id, label: item.label, status: statusOf_(id), kind: 'material', evidence: item.note, sourceId: id, action: '', required: item.required !== false };
      });
      return { sources, requirements };
    }
    // 原文没有列清单：回到常用资料。
    const common = window.PolicyData.createTaskSeed({}).requirements.map(item => ({ ...item, status: statusOf_(item.sourceId) }));
    return { sources, requirements: common };
  }

  function chooseStep(task, policy) {
    const changed = task.policyId !== policy.id;
    return { policyId: policy.id, status: 'processing', ...(changed ? applicationPatch(task, policy) : {}), steps: changed ? { match: true, diagnosis: false, assembly: false, review: false } : { match: true } };
  }

  /* 材料清单先说明政策依据；办理渠道另放办理指引。 */
  function applicationIntro(task) {
    const policy = publicPolicies().find(item => item.id === task.policyId);
    if (!policy) return '';
    const app = policy.application;
    const source = `<a href="${esc(policy.sourceUrl)}" target="_blank" rel="noopener noreferrer">《${esc(policy.title)}》</a>`;
    const downloads = (app?.templates || []).filter(item => /\.(zip|docx?|pdf)(?:[?#]|$)/i.test(item.url));
    const missing = app?.templateStatus === 'missing' ? `<p class="template-missing">这项政策有申报模板，但暂未收录。可以从${source}的附件下载后上传，上传后照常整理材料。</p>` : '';
    return `<div class="chat-gap-templates">${missing}<p>${app ? `根据${source}，需要准备以下资料：` : `${source}未列出具体材料清单，以下为常用资料，待按原文核对。`}</p>${downloads.map(item => `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.label)}</a>`).join('')}</div>`;
  }

  /* 官方系统相关的说明和指南链接，都放在提交抽屉里。 */
  function applicationGuidance(policy) {
    const app = policy?.application;
    if (!app?.templateNote && !app?.templates?.length) return '';
    return `<p>${esc(app.templateNote || '')}</p>${(app.templates || []).map(item => `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.label)}</a>`).join('')}`;
  }

  function applicationNote(task, item) {
    return publicPolicies().find(policy => policy.id === task.policyId)?.application?.checklist.find(entry => `${task.policyId}-${entry.id}` === item.id)?.note || '';
  }

  /* ---------- 办理指引：对话里是步骤，点开在右侧抽屉看详情；提交由用户本人完成 ---------- */
  const latestVersion = task => S().getState().versions.filter(version => version.taskId === task.id).sort((a, b) => b.number - a.number)[0];

  function guidanceMarkup(task) {
    const policy = task.steps.match ? window.PolicyData.policies.find(item => item.id === task.policyId && !item.noPolicy) : null;
    if (!policy) return '';
    const open = publicPolicies().find(item => item.id === policy.id);
    const latest = latestVersion(task);
    const submit = open?.application?.submit;
    const deadline = submit?.deadline || (open ? windowText(open) : policy.deadline);
    const scored = open ? policyScore(task, open) : null;
    if (hasNoTemplate(open)) {
      const items = open.application.checklist.filter(item => item.kind !== 'condition');
      const row = `<ol class="guidance-list"><li><button type="button" class="guidance-step" data-route="guidance" data-task="${esc(task.id)}" data-work="guidance"><span class="guidance-step-number">1</span><span class="guidance-step-copy"><strong>材料清单和办理步骤</strong><small>共 ${items.length} 项材料，${esc(submit.name)}，${esc(deadline)}截止</small></span>${icon('arrow')}</button></li></ol>`;
      return assistantBubble('这项政策没有申报模板，不生成初稿。按材料清单准备后，到官方系统办理。', row, 'guidance');
    }
    const rows = [
      { title: '检查申报材料', detail: !latest ? '还没有申报材料' : scored ? `V${latest.number}，材料准备度 ${scored.ready}/${scored.total}` : `V${latest.number}，点开查看全部内容`, attrs: latest ? `data-route="version" data-id="${esc(latest.id)}"` : 'data-route="task"', work: latest ? 'guidance' : 'assembly', state: !latest ? '待整理' : latest.status === 'confirmed' ? '已确认' : '待确认', done: latest?.status === 'confirmed' },
      { title: '到官方系统提交', detail: submit ? `${submit.name}，${deadline}截止` : '按政策指定的官方渠道办理', attrs: 'data-route="guidance"', state: '' },
    ];
    const card = `<ol class="guidance-list">${rows.map((row, index) => `<li><button type="button" class="guidance-step" ${row.attrs} data-task="${esc(task.id)}" data-work="${row.work || 'guidance'}"><span class="guidance-step-number">${index + 1}</span><span class="guidance-step-copy"><strong>${esc(row.title)}</strong><small>${esc(row.detail)}</small></span>${row.state ? `<span class="guidance-step-state${row.done ? ' is-done' : ''}">${esc(row.state)}</span>` : ''}${icon('arrow')}</button></li>`).join('')}</ol>`;
    return assistantBubble(`接下来这样办，点开每一步看详情。`, card, 'guidance');
  }

  /* 申报辅助里选到没有模板的政策：不生成初稿，转到办理指引。 */
  function noTemplateNotice(task) {
    const policy = publicPolicies().find(item => item.id === task.policyId);
    if (!task.steps.match || !hasNoTemplate(policy)) return '';
    return assistantBubble('这项政策没有申报模板，不生成初稿。材料清单和办理步骤都在办理指引里。', `<div class="intake-foot is-end prep-no-template"><button type="button" class="button button-primary" data-route="task" data-task="${esc(task.id)}" data-work="guidance">查看办理指引 ${icon('arrow')}</button></div>`, 'assembly');
  }

  /* 打开材料时按这版内容重新估一次成功率。 */
  function versionReview(task, version) {
    const policy = task?.policyId === version.policyId ? publicPolicies().find(item => item.id === version.policyId) : null;
    const result = policy && policyScore(task, policy);
    if (!result) return '';
    return `<section class="drawer-summary version-review vd-summary"><div class="vd-score"><span>材料准备度</span><strong>${result.ready}<small>/${result.total}</small></strong></div><div class="vd-summary-text"><p>按这版材料重新核对</p><small>已备 ${result.ready}/${result.total} 项必传材料</small><small>仅供参考，最终以主管部门审核为准。</small></div></section>`;
  }

  /* 抽屉里的提交详情；没有整理过的政策沿用原来的办理页。 */
  /* 前往官方系统：先二次确认，同一政策确认过就不再问；每次都记一条事件。 */
  const jumpKey = 'huiqi-prep-bubble-20261104-huiqi-official-jumps';
  const confirmedJumps = new Set();
  function jumpEvents() { try { return JSON.parse(localStorage.getItem(jumpKey) || '[]'); } catch { return []; } }
  function recordJump(link) {
    const events = jumpEvents();
    events.push({ taskId: link.dataset.task, policyId: link.dataset.policy, platform: link.dataset.name, url: link.href, source: 'guidance', at: new Date().toISOString() });
    try { localStorage.setItem(jumpKey, JSON.stringify(events.slice(-200))); } catch {}
  }
  function jumpLog(taskId, policyId) {
    const last = jumpEvents().filter(item => item.taskId === taskId && item.policyId === policyId).at(-1);
    if (!last) return '';
    const date = new Date(last.at);
    return `<p class="guidance-jump-log">已于 ${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())} 前往官方系统</p>`;
  }
  function goOfficial(link) {
    confirmedJumps.add(link.dataset.policy);
    recordJump(link);
    window.open(link.href, '_blank', 'noopener');
    window.PolicyUI.refresh();
  }
  function closeLeaveDialog() { document.querySelector('#leave-dialog')?.remove(); }
  function openLeaveDialog(link) {
    closeLeaveDialog();
    const dialog = document.createElement('div');
    dialog.id = 'leave-dialog';
    dialog.className = 'leave-dialog';
    dialog.innerHTML = `<button type="button" class="leave-dialog-scrim" data-leave="cancel" aria-label="取消" tabindex="-1"></button><section role="dialog" aria-modal="true" aria-labelledby="leave-title"><h2 id="leave-title">即将离开本产品</h2><p>即将前往${esc(link.dataset.name)}办理，申报与审核以该平台为准。</p><div class="leave-dialog-actions"><button type="button" class="button button-secondary" data-leave="cancel">取消</button><button type="button" class="button button-primary" data-leave="go">继续前往 ${icon('arrow')}</button></div></section>`;
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      const action = event.target instanceof Element ? event.target.closest('[data-leave]')?.dataset.leave : '';
      if (!action) return;
      closeLeaveDialog();
      if (action === 'go') goOfficial(link); else link.focus({ preventScroll: true });
    });
    dialog.querySelector('[data-leave="go"]').focus({ preventScroll: true });
  }
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest('a[data-official-jump]') : null;
    if (!link) return;
    event.preventDefault();
    if (confirmedJumps.has(link.dataset.policy)) goOfficial(link); else openLeaveDialog(link);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeLeaveDialog(); });

  function guidanceDetail(task) {
    const policy = task.steps.match ? publicPolicies().find(item => item.id === task.policyId) : null;
    if (!policy) return '';
    const submit = policy.application?.submit;
    const left = statusOf(policy) === 'open' ? daysLeft(policy) : null;
    const facts = [['截止时间', submit?.deadline || windowText(policy)], ...(left !== null ? [['还剩', `${left} 天`]] : []), ...(submit?.contact ? [['咨询', submit.contact]] : [])];
    const steps = [
      { title: '打开官方系统', detail: submit ? submit.name : '按原文写明的渠道办理', action: `<a class="button button-primary" href="${esc(submit?.url || policy.sourceUrl)}" target="_blank" rel="noopener noreferrer" data-official-jump data-task="${esc(task.id)}" data-policy="${esc(policy.id)}" data-name="${esc(submit?.name || policy.agency)}">${submit ? '打开系统' : '查看原文'} ${icon('arrow')}</a>` },
      ...(submit ? submit.steps : []).map(step => ({ title: step })),
      { title: '保存回执', detail: '提交后保存系统的回执，以便后续查询。' },
    ];
    return `<div class="guidance-detail"><h2 class="sr-only">到官方系统提交</h2><section class="drawer-summary guidance-summary"><p>${esc(policy.title)}</p><dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></section>${hasNoTemplate(policy) ? `<section class="guidance-materials"><h3>材料清单</h3><p>这项政策没有申报模板，不生成初稿，按清单准备。</p><ul>${policy.application.checklist.filter(item => item.kind !== 'condition').map(item => `<li><strong>${esc(item.label)}</strong>${item.note ? `<small>${esc(item.note)}</small>` : ''}</li>`).join('')}</ul></section>` : ''}<ol class="guidance-timeline">${steps.map(step => `<li${step.detail ? '' : ' class="is-plain"'}><div><strong>${esc(step.title)}</strong>${step.detail ? `<small>${esc(step.detail)}</small>` : ''}</div>${step.action || ''}</li>`).join('')}</ol>${jumpLog(task.id, policy.id)}<p class="guidance-note">登录和提交要你本人在官方系统完成。</p>${applicationGuidance(policy) ? `<div class="guidance-policy-note">${applicationGuidance(policy)}</div>` : ''}</div>`;
  }

  /* 公开政策的详情：和政策列表用同一张结构化卡片。 */
  function policyDetail(task, policyId) {
    const policy = publicPolicies().find(item => item.id === policyId);
    if (!policy) return '';
    const matched = matchPolicies(factsOf(task)).find(item => item.policy.id === policyId);
    return `<div class="match-drawer-body-inline">${policyCard(task, { policy, status: statusOf(policy), reasons: matched?.reasons || [] }, false)}</div>`;
  }

  /* ---------- 政策解读：在对话里选政策、看解读 ---------- */
  const factsOf = task => {
    const answers = answersOf(task);
    return { ...answers, region: answers.region || task.company.region, industry: answers.industry || task.company.industry };
  };

  /* 按画像排序；画像对不上任何政策时列出全部，解读不要求企业符合条件。 */
  function interpretMatches(task) {
    const matched = matchPolicies(factsOf(task));
    return matched.length ? matched : matchPolicies({});
  }

  const interpretId = task => task.interpretPolicyId || '';
  const interpretingPublic = task => publicPolicies().find(policy => policy.id === interpretId(task));
  // 选的是内置项目自带的政策时，沿用原来的对话内容。
  const interpretActive = task => !interpretId(task) || Boolean(interpretingPublic(task));

  /* 匹配分（PRD 8.1.4）：准入条件（地区、行业）只过滤，未知不过滤、标待确认；量化条件按“现有 ÷ 要求”算，取平均，结果取整；
     材料只算准备度，不计入匹配分。原型没有“优先支持项”，量化条件占 100。 */
  const FIRST_PICK_MIN = 50;  // 首选推荐门槛，暂定 50，可配置
  const GAP_LINE = 50;        // 低于这条线提示“条件差距较大”
  function scoreOf(rows) {
    const gate = rows.filter(row => row.kind === '准入条件'), metrics = rows.filter(row => row.kind === '量化条件');
    const blocked = gate.some(row => row.status === 'missing');
    const measured = metrics.filter(row => row.metric.have !== null);
    const score = !metrics.length ? 100 : measured.length ? Math.round(measured.reduce((sum, row) => sum + Math.min(1, row.metric.have / row.metric.need), 0) / measured.length * 100) : null;
    const pending = [...gate, ...metrics].filter(row => row.status === 'unknown').length;
    // 展示：全部未知显示“待确认”；≥90 显示“预估匹配分较高”；≤10 显示“预估匹配分较低”；其余显示具体分数。
    const level = blocked ? '准入不符' : score === null ? '待确认' : score >= 90 ? '预估匹配分较高' : score <= 10 ? '预估匹配分较低' : `${score} 分`;
    return { score, level, pending, blocked };
  }
  function comparisonRows(task, policy) {
    const { region, industry } = factsOf(task);
    const metrics = policyMetrics(task, policy);
    const items = (policy.application?.checklist || []).filter(item => item.kind !== 'condition' && item.required !== false);
    const ready = items.filter(item => task.sources?.some(source => source.id === `${policy.id}-${item.id}` && source.provided)).length;
    const row = (key, label, required, current, max, ratio, action) => ({key,label,required,current,max,points:ratio===null?null:Math.round(max*Math.min(1,Math.max(0,ratio))),status:ratio===null?'unknown':ratio>=1?'ready':'missing',action});
    const rows = [
      row('region','适用地区',policy.region,region||(policy.region==='全国'?'不限地区':'待补充'),15,policy.region==='全国'?1:!region?null:region===policy.region?1:0,'核对地区'),
      row('industry','所属行业',policy.industries.join('、')||'以原文为准',industry||'待补充',15,!industry||industry==='其他行业'||!policy.industries.length?null:policy.industries.includes(industry)?1:0,'核对行业'),
      ...metrics.map((item,index)=>({...row(item.key,item.label,`≥ ${item.need} ${item.unit}`,item.have===null?'待核实':`${item.have} ${item.unit}`,Math.floor(30/metrics.length)+(index===0?30%metrics.length:0),item.have===null?null:item.have/item.need,'核对数量'),metric:item})),
      {...row('materials','申报材料',items.length?`${items.length} 项必需材料`:'清单待核实',`${ready} 项已上传`,metrics.length?40:70,items.length?ready/items.length:null,'补充材料'),ready,total:items.length},
    ];
    rows.forEach(row => { row.kind = ['region', 'industry'].includes(row.key) ? '准入条件' : row.key === 'materials' ? '材料（不计入匹配分）' : '量化条件'; });
    return rows;
  }
  function policyScore(task, policy) {
    if (!task?.id) return null;
    const rows=comparisonRows(task,policy),materials=rows.find(row=>row.key==='materials');
    return {...scoreOf(rows),rows,ready:materials.ready,total:materials.total,known:questions.filter(question=>answersOf(task)[question.key]).length,knownTotal:questions.length};
  }

  /* 正在申报且匹配分低于 50 时只提示，不拦截。 */
  const suggestPause = (result, policy) => Boolean(result) && result.score !== null && result.score < GAP_LINE && statusOf(policy) === 'open';
  const pauseTag = '<em class="policy-pause">条件差距较大，建议先补齐</em>';

  function scoreBadge(task, policy) {
    const result = policyScore(task, policy);
    return result ? `<span class="policy-score${result.score === null || result.score >= 90 || result.score <= 10 ? ' is-text' : ''}"><strong>${result.score !== null && result.score > 10 && result.score < 90 ? `${result.score}<small>分</small>` : result.level}</strong><small>匹配分</small>${suggestPause(result, policy) ? pauseTag : ''}</span>` : '';
  }

  function scoreText(task, policy) {
    const result = policy && policyScore(task, policy);
    if (!result) return '告诉我企业名称和情况，我才能算匹配分。';
    return `本产品不估算获批概率。按现在的信息，「${policy.title}」的匹配分是${result.level}${result.pending ? `，还有 ${result.pending} 项待确认，补充后更准` : ''}；材料准备度 ${result.ready}/${result.total}。${{ open: '', notice: '这项政策暂未开放申报，可以提前准备。', closed: '这项政策已截止，本期无法申报。' }[statusOf(policy)]}最终以主管部门审核为准。`;
  }

  function scorePanel(task, policy) {
    const status = statusOf(policy);
    const result = policyScore(task, policy);
    return `<div class="interpret-score"><div class="score-orb${result ? '' : ' is-empty'}">${result ? `<strong>${result.level}</strong>` : '<strong>--</strong>'}<span>匹配分</span></div><p>${status === 'open' ? '' : status === 'closed' ? '这项政策已截止。' : '这项政策暂无申报窗口。'}${result ? '按现在的信息和资料估算，最终以主管部门审核为准。' : '告诉我企业情况和资料，我来估算。'}</p></div>`;
  }

  const viewButton = (task, policy) => `<button type="button" class="text-button match-policy-view" data-action="match-drawer" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">查看 ${icon('chevron')}</button>`;

  function interpretPicker(task) {
    const matches = interpretMatches(task);
    const hasFacts = factsOf(task).region || factsOf(task).industry;
    const guide = hasFacts ? '' : `<div class="interpret-guide"><p>告诉我企业名称和情况，可以算匹配分。</p>${task.id ? `<button type="button" class="text-button" data-action="portrait-edit" data-task="${esc(task.id)}">补充企业信息</button>` : '<button type="button" class="text-button" data-action="home-start-expert" data-work="profile">补充企业信息</button>'}</div>`;
    const cards = matches.map(({ policy, status }) => `<article class="match-policy is-compact is-clickable is-${status}${policyScore(task, policy) ? ' has-score' : ''}">${scoreBadge(task, policy)}<p class="match-policy-tag">${{ open: '正在申报', notice: '政策方向', closed: '已截止' }[status]}</p><h3><button type="button" class="match-policy-open" data-action="match-drawer" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">${esc(policy.title)}</button></h3><p class="match-policy-meta">${esc(policy.region)} · ${esc(windowText(policy))}</p>${viewButton(task, policy)}</article>`).join('');
    return assistantBubble('想了解哪项政策？选一项，我来讲清楚。', `<div class="intake-card match-result${onlyOpen ? ' only-open' : ''}"><div class="match-result-bar">${onlyOpenToggle()}</div>${guide}<div class="match-policy-grid">${cards}</div></div>`, 'match');
  }

  /* 模拟数据：等接入政策结构化数据和企业数据库后替换。门槛按政策的支持方向给，不是政策原文；企业数量按名称算，同一企业每次一样。 */
  const mockThresholds = {
    研发支持: [{ key: 'patents', label: '专利', need: 3, unit: '个' }, { key: 'rdStaff', label: '研发人员', need: 10, unit: '人' }],
    资质培育: [{ key: 'patents', label: '专利', need: 1, unit: '个' }, { key: 'copyrights', label: '软件著作权', need: 2, unit: '个' }],
    数字化改造: [{ key: 'copyrights', label: '软件著作权', need: 1, unit: '个' }, { key: 'rdStaff', label: '研发人员', need: 5, unit: '人' }],
    金融支持: [{ key: 'patents', label: '专利', need: 1, unit: '个' }],
  };
  function mockCompanyData(task) {
    const name = task?.company?.name;
    if (!name) return null;
    const hash = [...name].reduce((sum, char) => (sum * 31 + char.codePointAt(0)) % 9973, 7);
    const defaults={patents:hash%4,copyrights:(hash>>2)%5,rdStaff:4+(hash>>3)%15};
    const answers=answersOf(task);
    return Object.fromEntries(Object.entries(defaults).map(([key,value])=>{
      const field=`metric_${key}`;
      if(!Object.hasOwn(answers,field))return [key,value];
      const n=Number(answers[field]);
      return [key,answers[field]!==''&&Number.isInteger(n)&&n>=0&&n<=1000000?n:null];
    }));
  }
  const companyRows = task => {
    const data = mockCompanyData(task);
    return data ? [['专利数量', data.patents===null?'待核实':`${data.patents} 个`], ['软件著作权', data.copyrights===null?'待核实':`${data.copyrights} 个`], ['研发人员', data.rdStaff===null?'待核实':`${data.rdStaff} 人`]] : [];
  };
  function policyMetrics(task, policy) {
    const data = mockCompanyData(task);
    return (mockThresholds[policy.supportType] || []).map(rule => ({ ...rule, have: data ? data[rule.key] : null, met: data && data[rule.key]!==null ? data[rule.key] >= rule.need : false }));
  }

  const metricUnit = unit => unit === '人' ? '名' : unit;
  const metricLine = ({ label, need, unit, have }) => `政策需要 ${need} ${metricUnit(unit)}${label}，您目前有 ${have} ${metricUnit(unit)}`;

  /* 单条政策的结构化对照：企业有什么、还缺什么。只用已知信息，不推断企业满足条件。 */
  function policyGap(task, policy) {
    const have = [], lack = [];
    const { region, industry } = factsOf(task), answers = answersOf(task);
    if (policy.region === '全国') have.push('全国范围的政策，地区不受限');
    else if (region) (region === policy.region ? have : lack).push(region === policy.region ? `企业在${region}，符合政策地区` : `政策面向${policy.region}，企业在${region}`);
    if (industry && industry !== '其他行业') (policy.industries.includes(industry) ? have : lack).push(policy.industries.includes(industry) ? `${industry}在政策涉及的行业内` : `政策涉及的行业里没有${industry}`);
    questions.forEach(question => { if (answers[question.key]) have.push(`${question.label}：${answers[question.key]}`); });
    const files = filesOf(task).length;
    if (files) have.push(`已上传 ${files} 份文件，待核对`);
    policyMetrics(task, policy).forEach(metric => {
      const { label, need, unit, have: count, met } = metric;
      if (count === null) lack.push(`政策需要 ${need} ${metricUnit(unit)}${label}`);
      else if (met) have.push(metricLine(metric));
      else {
        if (count > 0) have.push(`${label} ${count} ${unit}`);
        lack.push(`${metricLine(metric)}，还差 ${need - count} ${metricUnit(unit)}`);
      }
    });
    const items = policy.application?.checklist;
    if (items) {
      items.forEach(item => {
        const id = `${policy.id}-${item.id}`;
        const note = item.note ? `（${item.note}）` : '';
        if (item.kind === 'condition') {
          if (task.requirements?.some(entry => entry.id === id && entry.status === 'ready')) have.push(`已核对：${item.label}`);
          else lack.push(`待确认：${item.label}${note}`);
        } else if (task.sources?.some(source => source.id === id && source.provided)) have.push(`已有：${item.label}`);
        else if (item.required !== false) lack.push(`${item.label}${note}`);
      });
    } else {
      policy.conditions.forEach(condition => lack.push(`待确认：${condition}`));
      policy.materials.forEach(material => lack.push(`需要准备：${material}`));
      if (!policy.conditions.length && !policy.materials.length) lack.push('原文没有列出具体要求，以原文为准');
    }
    return { have, lack };
  }

  const patentServices = [
  {
    "id": 481099123631909,
    "name": "专利挖掘与技术交底书撰写辅导",
    "description": "梳理技术创新点，辅导完成技术交底书撰写。",
    "cover": "https://cdn-esp.wanmol.com/espprod/wlyd-oss-aiplatform-esp-public/114/20260921/147c9c9b-6cea-4471-a022-e7d524a6f593/012_06%E5%B7%A6%E5%AF%B9%E9%BD%90%E5%BA%8F%E5%8F%B7%E5%88%97%E4%B8%BE_%E4%B8%93%E5%88%A9%E6%8C%96%E6%8E%98%E4%B8%8E%E6%8A%80%E6%9C%AF%E4%BA%A4%E5%BA%95%E4%B9%A6%E6%92%B0%E5%86%99%E8%BE%85%E5%AF%BC.png"
  },
  {
    "id": 474618015867237,
    "name": "高价值发明专利申请 （含专利挖掘或检索）",
    "description": "结合技术交底与检索结果，撰写发明专利申请文件。",
    "cover": "https://cdn-esp.wanmol.com/espprod/wlyd-oss-aiplatform-esp-public/114/20260911/257e750e-cdf3-4595-9d3d-6c85725ce463/%E9%AB%98%E4%BB%B7%E5%80%BC%E5%8F%91%E6%98%8E%E4%B8%93%E5%88%A9%E7%94%B3%E8%AF%B7.png"
  },
  {
    "id": 459820346444869,
    "name": "实用新型专利风险代理",
    "description": "前置新颖性检索，持证代理人撰写，驳回可按约定申请退费。",
    "cover": "https://cdn-esp.wanmol.com/espprod/wlyd-oss-aiplatform-esp-public/114/20260723/5eb88cf3-b0be-4f54-bb8f-3f03362f8359/%E4%B8%93%E5%88%A9%E4%BA%8B%E5%8A%A1%E6%89%80%E6%B7%98%E5%AE%9D%E5%BA%97%E9%93%BA%E7%85%A7%E7%89%87%E8%AE%BE%E8%AE%A1_%282%29.png"
  },
  {
    "id": 474660929745317,
    "name": "外观专利设计申请",
    "description": "准备外观设计申请文件，完成提交与审查意见答复。",
    "cover": "https://cdn-esp.wdsheng.com/espprod/wlyd-oss-aiplatform-esp-public/114/20260911/f43e2d4a-8f7d-44c5-addd-7c0b871470f1/%E5%A4%96%E8%A7%82.png"
  },
  {
    "id": 474663519678885,
    "name": "发明专利交底材料整理",
    "description": "代理人与发明人沟通并整理交底材料，同步进行检索。",
    "cover": "https://cdn-esp.wanmol.com/espprod/wlyd-oss-aiplatform-esp-public/114/20260911/1a7d043e-b523-4ce2-86b4-b9fd9ceb2f20/%E4%BA%A4%E5%BA%95%E6%95%B4%E7%90%86.png"
  },
  {
    "id": 483900867303493,
    "name": "专利导航",
    "description": "根据企业实际情况，提供定制化分析方案。",
    "cover": "https://cdn-esp.wdsheng.com/espprod/wlyd-oss-aiplatform-esp-public/114/20260929/5082c813-826f-4f49-9d0d-a448fae960bc/02_%E4%B8%93%E5%88%A9%E5%AF%BC%E8%88%AA.jpg"
  }
];
  const patentServiceDestination = 'https://www.wdsheng.com/employer/find-service/detail/479304003798693';
  /* 换一批：只换卡片本身，抽屉不重绘、不滚动。 */
  const serviceBatchSize = 2;
  let serviceBatch = 0;
  const serviceCards = () => patentServices.slice(serviceBatch*serviceBatchSize,(serviceBatch+1)*serviceBatchSize).map(service=>`<a class="interpret-service-card is-marketplace" href="${patentServiceDestination}" target="_blank" rel="noopener noreferrer"><img class="interpret-service-thumbnail" src="${esc(service.cover)}" alt="" width="76" height="76"><div class="interpret-service-copy"><h4>${esc(service.name)}</h4><p>${esc(service.description)}</p><span class="interpret-service-entry">查看服务 ${icon('arrow')}</span></div></a>`).join('');
  /* AI 建议：学芝麻分的提分逻辑，说清现在多少、做哪一步、能提到多少。数字只来自对照表的分项差额；有专利缺口时优先推专利服务。 */
  function adviceMarkup(policy,result) {
    if(!result||statusOf(policy)!=='open')return '';
    // 地区、行业不符靠补资料改变不了；材料不计入匹配分。只从量化条件里挑一步。
    const gaps=result.rows.filter(row=>row.kind==='量化条件'&&row.metric.have!==null&&row.status==='missing');
    const patents=gaps.find(row=>row.key==='patents');
    const step=patents||[...gaps].sort((a,b)=>(a.metric.need-a.metric.have)/a.metric.need-(b.metric.need-b.metric.have)/b.metric.need)[0];
    const next=step?scoreOf(result.rows.map(row=>row===step?{...row,status:'ready',metric:{...row.metric,have:row.metric.need}}:row)):result;
    const lift=step&&result.score!==null&&next.score>result.score;
    const now=`按现有信息，这项政策的匹配分为 <b>${result.level}</b>`;
    const text=step?`${now}，补充 ${step.metric.need-step.metric.have} ${metricUnit(step.metric.unit)}${esc(step.metric.label)}后${lift?`，匹配分可提高到 <b>${next.level}</b>`:'，更接近政策要求'}${patents?'，为您推荐专利服务':''}。`:result.pending?`${now}。还有 ${result.pending} 项待确认，补充后更准。`:`${now}。条件已基本符合，可以准备申报材料。`;
    const meter=lift?`<div class="interpret-advice-lift" aria-hidden="true"><div class="interpret-advice-numbers"><span>${result.score}</span>${icon('arrow')}<strong>${next.score}</strong><em>+${next.score-result.score}</em></div><div class="interpret-advice-bar"><i style="width:${result.score}%"></i><i class="is-gain" style="width:${next.score-result.score}%"></i></div></div>`:'';
    return `<aside class="interpret-advice${meter?'':' is-plain'}" aria-label="AI 建议"><div class="interpret-advice-copy"><span class="interpret-advice-tag">${icon('spark')} AI 建议</span><p>${text}</p><small>按现有信息判断，仅供参考，以主管部门审核为准。</small></div>${meter}</aside>`;
  }
  function recommendationMarkup(task,policy,rows) {
    if(!task.id)return '';
    const patents=rows.find(row=>row.key==='patents'&&row.metric?.have!==null&&row.metric?.have<row.metric?.need);
    const title=patents?`还差 ${patents.metric.need-patents.metric.have} 项专利，看看如何补齐`:'专利撰写服务';
    return `<section class="interpret-services" aria-labelledby="interpret-services-title"><div class="interpret-section-heading"><span>03</span><div><h3 id="interpret-services-title">${esc(title)}</h3><p>万大圣 · 专业知识产权服务</p></div><button type="button" class="text-button interpret-service-refresh" data-action="interpret-services-refresh">${icon('refresh')} 换一批</button></div><div class="interpret-service-grid" aria-live="polite">${serviceCards()}</div></section>`;
  }
  const hasNoTemplate = policy => policy?.application?.noTemplate === true;
  function interpretFooter(task,policy) {
    const status=statusOf(policy),chosen=task.steps.match&&task.policyId===policy.id;
    const noTemplate=hasNoTemplate(policy);
    return `<footer class="interpret-footer"><div><span>下一步</span><strong>${status==='closed'?'本期申报已截止':noTemplate?'这项政策没有申报模板，按办理指引准备':'整理本项政策的申报材料'}</strong></div>${status==='open'||chosen?`<button type="button" class="button button-primary" data-action="interpret-apply" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">${noTemplate?'查看办理指引':chosen?'去准备材料':'申报这项政策'} ${icon('arrow')}</button>`:`<a class="text-button" href="${esc(policy.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看政策原文 ${icon('arrow')}</a>`}</footer>`;
  }
  /* 对照表的“编辑”在现状格里原地改，同一时间只开一行。 */
  let interpretEditKey = '';
  const fieldOptions = key => [...new Set(publicPolicies().flatMap(policy => key === 'region' ? [policy.region] : policy.industries))].filter(item => item && item !== '全国');
  function comparisonEditor(task,row,attrs) {
    const value=row.metric?row.metric.have:factsOf(task)[row.key];
    const field=row.metric?'type="number" min="0" max="1000000" step="1" placeholder="未知可留空"':`type="text" maxlength="100" list="interpret-field-options" placeholder="填写${esc(row.label)}"`;
    const options=row.metric?'':`<datalist id="interpret-field-options">${fieldOptions(row.key).map(option=>`<option value="${esc(option)}"></option>`).join('')}</datalist>`;
    return `<div class="comparison-edit"><input id="interpret-field" ${attrs} ${field} value="${esc(value??'')}" aria-label="企业${esc(row.label)}">${row.metric?`<span>${esc(row.metric.unit)}</span>`:''}${options}</div>`;
  }
  function comparisonRow(task,policy,row) {
    const labels=row.key==='materials'?{ready:'已上传',missing:'待补充',unknown:'待补充'}:{ready:'符合',missing:'可能不符',unknown:'未知'},editing=interpretEditKey===row.key;
    const attrs=`data-task="${esc(task.id)}" data-policy="${esc(policy.id)}" data-key="${row.key}"`;
    const current=editing?comparisonEditor(task,row,attrs):`${esc(row.current)}<span class="comparison-state is-${row.status}">${labels[row.status]}</span>`;
    const actions=editing?'':row.key==='materials'?`<button type="button" class="text-button" data-action="interpret-todo" ${attrs}>${row.status==='ready'?'查看材料':row.action}</button>`:`<button type="button" class="text-button" data-action="interpret-todo" ${attrs} aria-label="编辑${esc(row.label)}">编辑</button>`;
    return `<tr data-dimension="${row.key}" data-state="${row.status}"${editing?' class="is-editing"':''}><th scope="row">${row.label}</th><td>${esc(row.required)}${row.metric?'<small class="interpret-rule-note">数量口径待原文核实</small>':''}</td><td>${current}</td><td class="comparison-points">${esc(row.kind)}</td><td>${actions}</td></tr>`;
  }
  const renderComparison = (task,policy) => { document.querySelector('.interpret-table tbody').innerHTML = comparisonRows(task,policy).map(row=>comparisonRow(task,policy,row)).join(''); };
  const focusComparisonEdit = key => document.querySelector(`[data-action="interpret-todo"][data-key="${key}"]`)?.focus({preventScroll:true});
  function cancelInterpretEdit() {
    const field=document.querySelector('#interpret-field'),key=interpretEditKey;
    if(!field||!key)return;
    const task=S().getTask(field.dataset.task),policy=publicPolicies().find(item=>item.id===field.dataset.policy);
    interpretEditKey='';
    if(task&&policy)renderComparison(task,policy);
    focusComparisonEdit(key);
  }
  /* 失焦、回车或点别处都走这里：改了就存，没改只退出编辑，填错恢复原值。 */
  function commitInterpretEdit(focusBack=false) {
    const field=document.querySelector('#interpret-field'),key=interpretEditKey;
    if(!field||!key)return;
    interpretEditKey='';
    const task=S().getTask(field.dataset.task),policy=publicPolicies().find(item=>item.id===field.dataset.policy);
    const row=task&&policy&&comparisonRows(task,policy).find(item=>item.key===key);
    if(!row)return;
    // 输入“上海”也能对上“上海市”，后面的匹配和评分都按标准写法算。
    const typed=field.value.trim(),value=!row.metric&&typed.length>=2&&fieldOptions(key).find(option=>option.startsWith(typed))||typed;
    const invalid=row.metric&&(field.validity?.badInput||value!==''&&(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>1000000));
    const changed=String(row.metric?row.metric.have??'':factsOf(task)[key]||'')!==value;
    if(invalid||!changed){
      renderComparison(task,policy);
      if(invalid)window.PolicyUI.toast('请填写有效的非负整数，这次没有保存。');
      if(focusBack)focusComparisonEdit(key);
      return;
    }
    const answers={...answersOf(task),[row.metric?`metric_${key}`:key]:value};
    const patch={intake:{...(task.intake||{stage:'ready',files:[]}),answers},...(!row.metric?{company:{[key]:value}}:{}),status:'processing',steps:{diagnosis:false,assembly:false,review:false}};
    if(!S().updateTask(task.id,patch)){renderComparison(task,policy);window.PolicyUI.toast('未能保存，请重试。');return;}
    const current=S().getTask(task.id);window.PolicyUI.refresh();updateInterpretDrawer(current,policy);
    if(focusBack)focusComparisonEdit(key);
    window.PolicyUI.toast('已保存，匹配分已更新。');
  }
  /* 这些资格条件平台核对不了，申报前让用户自己确认。 */
  function conditionsNotice(policy) {
    const items = (policy.application?.checklist || []).filter(item => item.kind === 'condition');
    return items.length ? `<div class="interpret-conditions"><h4>申报前请确认</h4><ul>${items.map(item => `<li>${esc(item.label)}${item.note ? `<small>${esc(item.note)}</small>` : ''}</li>`).join('')}</ul></div>` : '';
  }
  function interpretCard(task, policy) {
    const result=policyScore(task,policy),rows=result?.rows||comparisonRows(task,policy),materials=rows.find(row=>row.key==='materials');
    const pending=rows.filter(row=>row.status!=='ready'&&row.key!=='materials').length;
    const facts=[['支持方向',policy.supportType],['适用地区',policy.region],['申报时间',windowText(policy)],['发布部门',policy.agency]];
    return `<div class="policy-review"><section class="interpret-overview"><div class="interpret-eyebrow">01 / 了解政策</div><h3><a class="interpret-title" href="${esc(policy.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(policy.title)} ${icon('arrow')}</a></h3><p class="interpret-summary">${esc(policy.summary)}</p><div class="interpret-summary-grid"><dl class="interpret-facts">${facts.map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><div class="interpret-score-result"><span>匹配分</span><strong data-total-score="${result?.score??''}">${result?result.level:'—'}</strong><div><b>${pending}</b> 项可能不符或未知</div>${suggestPause(result, policy) ? pauseTag : ''}<small>${{ open: '地区、行业只做准入判断，未知不过滤；量化条件按现有 ÷ 要求计算；材料不计入匹配分', notice: '暂未开放申报，可以提前准备', closed: '本期已截止，无法申报' }[statusOf(policy)]}</small></div></div>${conditionsNotice(policy)}</section><section class="interpret-comparison" aria-labelledby="comparison-title"><div class="interpret-section-heading"><span>02</span><div><h3 id="comparison-title">逐项对照，看看还差什么</h3><p>核对企业现状，再准备对应资料。</p></div></div><div class="interpret-table-scroll" tabindex="0" role="region" aria-label="政策条件对照表"><table class="interpret-table"><thead><tr><th scope="col">对照维度</th><th scope="col">政策要求</th><th scope="col">企业现状</th><th scope="col">条件类型</th><th scope="col">操作</th></tr></thead><tbody>${rows.map(row=>comparisonRow(task,policy,row)).join('')}</tbody></table></div><div id="interpret-supplement" aria-live="polite"></div>${policy.applicationTimeNote?`<p class="interpret-time-note">${esc(policy.applicationTimeNote)}</p>`:''}</section>${adviceMarkup(policy,result)}${recommendationMarkup(task,policy,rows)}</div>`;
  }

  function updateInterpretDrawer(task,policy) {
    const drawer=document.querySelector('#match-drawer');if(!drawer)return;
    drawer.querySelector('.match-drawer-body').innerHTML=interpretCard(task,policy);
    drawer.querySelector('.interpret-footer').outerHTML=interpretFooter(task,policy);
  }
  function materialsMarkup(task,policy) {
    const items=(policy.application?.checklist||[]).filter(item=>item.kind!=='condition'&&item.required!==false);
    return `<div class="interpret-supplement-card"><h4>本项政策的材料清单</h4><ul>${items.map(item=>`<li>${task.sources.some(source=>source.id===`${policy.id}-${item.id}`&&source.provided)?'已上传':'待准备'} · ${esc(item.label)}</li>`).join('')||'<li>请先核对原文中的材料要求。</li>'}</ul><button type="button" class="button button-primary" data-action="interpret-apply" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">${task.policyId===policy.id?'去上传材料':'选定这项政策，上传材料'} ${icon('arrow')}</button></div>`;
  }

  function interpretMarkup(task) {
    if (!task || !interpretActive(task)) return '';
    return interpretPicker(task);
  }

  const interpretPicking = task => Boolean(task) && !interpretId(task);

  /* ---------- 只想了解政策：不填企业名称、不建项目 ---------- */
  const guest = { policyId: '', messages: [], applying: false };
  const guestTask = () => ({ id: '', company: { name: '', region: '', industry: '' }, steps: {}, interpretPolicyId: guest.policyId, requirements: [], sources: [] });

  function guestMarkup() {
    const row = message => message.role === 'user' ? userBubble(message.text) : assistantBubble(message.text, '', 'match');
    const form = guest.applying ? assistantBubble('告诉我企业名称，我接着帮你查还差什么。', `<form id="company-start-form" class="intake-card home-start-card" data-work="diagnosis" data-apply-policy="${esc(guest.policyId)}"><div class="intake-name-row"><label for="start-company-name">企业名称</label><input id="start-company-name" name="companyName" type="text" maxlength="300" required autocomplete="organization" placeholder="请输入企业全称"></div><div class="intake-foot is-end"><button type="submit" class="button button-primary">继续 ${icon('arrow')}</button></div></form>`, 'match') : '';
    return `${interpretMarkup(guestTask())}${guest.messages.map(row).join('')}${form}`;
  }

  function guestAsk(text) {
    guest.messages.push({ role: 'user', text, workId: 'match' }, { role: 'assistant', text: window.PolicyChat.answerFor(guestTask(), text, 'match'), workId: 'match' });
  }

  function finishGuest(task, policyId) {
    const policy = publicPolicies().find(item => item.id === policyId);
    if (!policy) return false;
    const saved = S().updateTask(task.id, { ...chooseStep(task, policy), interpretPolicyId: policy.id, messages: guest.messages.map(message => ({ ...message, expertId: 'policy-adviser' })) });
    Object.assign(guest, { policyId: '', messages: [], applying: false });
    return saved;
  }

  function resetGuest() {
    closeDrawer();
    Object.assign(guest, { policyId: '', messages: [], applying: false });
    Object.assign(homeIntake, { open: false, answers: {} });
  }

  function handleGuest(action, target) {
    if (action === 'match-drawer') { openDrawer(guestTask(), target); return; }
    closeDrawer();
    if (action === 'interpret-apply') guest.applying = true;
    window.PolicyUI.refresh();
    if (guest.applying) { const input = document.querySelector('#start-company-name'); input?.scrollIntoView?.({ block: 'nearest' }); input?.focus({ preventScroll: true }); }
  }

  /* ---------- 右栏企业画像就地编辑 ---------- */
  let portraitEditTask = '';
  const portraitEditing = taskId => portraitEditTask === taskId;

  function swapPortrait(task) {
    const box = document.querySelector('.workspace-summary');
    if (box) box.outerHTML = window.PolicyWorkspace.portraitMarkup(task);
  }

  function portraitField(task, question) {
    const answers = answersOf(task);
    const current = question.key === 'region' ? task.company.region || answers.region : question.key === 'industry' ? task.company.industry || answers.industry : answers[question.key];
    const options = [...question.options, ...(current && !question.options.includes(current) ? [current] : [])];
    return `<select id="portrait-${question.key}" data-portrait-field="${question.key}"><option value="">待补充</option>${options.map(option => `<option value="${esc(option)}"${option === current ? ' selected' : ''}>${esc(option)}</option>`).join('')}</select>`;
  }

  function portraitEditor(task) {
    const rows = questions.map(question => `<div><label for="portrait-${question.key}">${esc(question.label)}</label>${portraitField(task, question)}</div>`).join('');
    return `<div class="workspace-portrait is-editing"><div><label for="portrait-name">企业名称</label><input id="portrait-name" type="text" maxlength="300" autocomplete="organization" value="${esc(task.company.name)}"></div>${rows}</div><div class="workspace-portrait-actions"><button type="button" class="text-button" data-action="portrait-cancel" data-task="${esc(task.id)}">取消</button><button type="button" class="button button-primary" data-action="portrait-save" data-task="${esc(task.id)}">保存</button></div>`;
  }

  function savePortrait(task) {
    const box = document.querySelector('.workspace-summary');
    const name = box.querySelector('#portrait-name').value.trim();
    if (!name) { window.PolicyUI.toast('企业名称不能为空。'); return; }
    const answers = {...answersOf(task)};
    box.querySelectorAll('[data-portrait-field]').forEach(field => { answers[field.dataset.portraitField] = field.value; });
    // 补上空项不影响已选政策；改了已有的企业事实，后面的结果要重新确认。
    const changed = name !== task.company.name;
    const title = task.title === `${task.company.name} · 政策申报` ? `${name} · 政策申报` : task.title;
    const intake = { ...(task.intake || { stage: 'ready', files: [] }), answers };
    if (!S().updateTask(task.id, { title, intake, company: { name }, ...(changed ? { steps: { ...resetSteps, profile: false } } : {}) })) { window.PolicyUI.toast('未能保存，请重试。'); return; }
    S().confirmWork(task.id, 'profile');
    portraitEditTask = '';
    window.PolicyUI.refresh();
    window.PolicyUI.toast(changed && task.steps.match ? '已保存，企业信息有变化，请重新确认政策。' : '已保存。');
  }

  /* 上传资料回显时打码：只改显示，存的原文和下载的 Word 不变。 */
  const maskSpan = '<span class="masked" role="img" aria-label="已打码">••••</span>';
  function maskedHtml(text) {
    return esc(text)
      .replace(/(?<!\d)(\d{6})(?:19|20)\d{9}([\dXx])(?!\d)/g, `$1${maskSpan}$2`)
      .replace(/(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g, `$1${maskSpan}$2`)
      .replace(/(?<!\d)(\d{4})\d{8,11}(\d{4})(?!\d)/g, `$1${maskSpan}$2`)
      .replace(/(法定代表人|法人代表|联系人|负责人)([:：]\s*)([一-龥])[一-龥]{1,3}/g, `$1$2$3${maskSpan}`);
  }

  /* ---------- 材料解析：原文、缺什么、怎么补、润色。规则检查，只对照政策写明的要点 ---------- */
  const wordRules = [
    { test: /我们公司|我司|我们/, problem: '自称偏口语，申报材料建议统一写“本企业”。' },
    { test: /非常|特别|十分/, problem: '程度词没有依据，建议删掉。' },
    { test: /很多/, problem: '数量说得模糊。' },
    { test: /搞(?=[一-龥])|弄好/, problem: '用词偏口语。' },
    { test: /[,;]|(?:^|[^0-9]):/, problem: '混用了半角标点。' },
  ];
  const wordFixes = [[/我们公司|我司|我们/g, '本企业'], [/(非常|特别|十分)/g, ''], [/很多/g, '多项'], [/搞(?=[一-龥])/g, '开展'], [/弄好/g, '完成'], [/,/g, '，'], [/;/g, '；'], [/(^|[^0-9]):/g, '$1：'], [/[ \t]+/g, ' ']];

  function reviewMaterial(task, source) {
    const policy = publicPolicies().find(item => item.id === task.policyId);
    const item = policy?.application?.checklist.find(entry => `${policy.id}-${entry.id}` === source.id);
    const unreadable = !source.text.trim() || /^【已上传文件：/.test(source.text);
    if (unreadable) return { unreadable: true, original: '', missing: [], advice: [], polished: '', note: item?.note || '' };
    const text = source.text;
    // 生成稿末尾“待补充”里列的词不算已写到。
    const written = text.split(/\n+/).filter(line => !S().hasPendingMark(line)).join('\n');
    const missing = (item?.expects || []).filter(word => !written.includes(word));
    const pending = text.split(/\n+/).filter(line => S().hasPendingMark(line)).map(pendingWhat);
    const advice = [];
    missing.forEach(word => advice.push(`补充“${word}”：政策要求写明，原文没有提到。`));
    if (!missing.length && pending.length) advice.push(`还有待补充的内容：${pending.join('、')}。`);
    if (text.length < 60) advice.push('内容偏短，建议写清具体做法和结果。');
    if (!/\d/.test(text)) advice.push('没有数字，建议补充金额、人数或时间，方便审核核实。');
    if (/【虚构|示例内容/.test(text)) advice.push('这是示例内容，提交前要换成真实资料。');
    return { unreadable: false, original: text, missing, pending, advice, items: adviceItems(text, missing, pending), hasRequirements: Boolean(item?.expects?.length), note: item?.note || '' };
  }

  /* AI 建议：逐条给出原文、问题和改法。目前是规则检查，没有接模型。 */
  const polishLine = line => wordFixes.reduce((value, [from, to]) => value.replace(from, to), line).trim();
  const pendingWhat = line => line.match(/[：:]([^】\]]*)[】\]]/)?.[1] || line.replace(/[【\[][^】\]]*[】\]]/, '').replace(/^请补充|。$/g, '').trim() || '相关内容';
  function adviceItems(text, missing, pending) {
    const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const isMeta = line => /^依据文件：/.test(line) || /^(?:[一二三四五六七八九十]+|\d+)、.{0,20}$/.test(line) || S().hasPendingMark(line);
    const body = lines.filter(line => !isMeta(line));
    const items = lines.filter(line => S().hasPendingMark(line)).map(line => ({ original: line, problem: '这部分还没有内容，不能直接提交。', suggestion: `补写${pendingWhat(line)}后重新上传；也可以多选几份企业文档，重新智能生成。` }));
    missing.filter(word => !pending.some(entry => entry.includes(word))).forEach(word => items.push({ original: '材料里没有相关内容', problem: `政策要求写明“${word}”，这份材料还没写到。`, suggestion: `增加一段“${word}”，写清具体内容和数据。` }));
    body.forEach(line => {
      const problems = wordRules.filter(rule => rule.test.test(line)).map(rule => rule.problem);
      const vague = line.match(/大量|显著|明显|领先|一流|较强|较大|丰富/);
      if (problems.length) items.push({ original: line, problem: problems.join(''), suggestion: polishLine(line) });
      if (vague && !/\d/.test(line)) items.push({ original: line, problem: `“${vague[0]}”没有数据支撑，审核不好核实。`, suggestion: `补上可核实的数据：${polishLine(line)}【请填写具体数字】` });
    });
    if (body.length) {
      if (!/\d/.test(body.join(''))) items.push({ original: body[0], problem: '整份材料没有金额、人数或时间，审核不好核实。', suggestion: `在这句后补充具体数字：${polishLine(body[0])}【金额、人数或时间】` });
      if (text.length < 60) items.push({ original: body[0], problem: '内容偏短，看不出具体做法和结果。', suggestion: '写清做了什么、怎么做、取得了什么结果，再重新上传。' });
      if (/【虚构|示例内容/.test(text)) items.push({ original: body[0], problem: '这是示例内容，不能用于提交。', suggestion: '换成企业的真实资料后重新上传。' });
    }
    return items;
  }

  /* 材料行下面的一句话建议，详情在“查看”的抽屉里。 */
  function materialAdvice(task, source) {
    const review = reviewMaterial(task, source);
    if (review.unreadable) return '这份文件读不到文字，上传 Word 或文本文件后才能解析。';
    if (review.missing.length) return `还没写到${review.missing.slice(0, 3).map(word => `“${word}”`).join('、')}${review.missing.length > 3 ? ' 等内容' : ''}，建议补充。`;
    if (review.advice[0]) return review.advice[0];
    return review.items.length ? `有 ${review.items.length} 处可以调整，点查看。` : '没有发现明显问题。';
  }

  function openMaterialReview(task, opener) {
    closeDrawer();
    const source = task.sources.find(item => item.id === opener.dataset.source);
    if (!source) return;
    const drawer = document.createElement('div');
    drawer.id = 'match-drawer';
    drawer.className = 'match-drawer';
    drawer.dataset.reviewSource = source.id;
    const body = materialReviewBody(task, source);
    drawer.innerHTML = `<button type="button" class="match-drawer-scrim" data-action="match-drawer-close" aria-label="关闭" tabindex="-1"></button><section class="match-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="match-drawer-title"><header><h2 id="match-drawer-title">${esc(source.name)}</h2><button type="button" class="icon-button match-drawer-close" data-action="match-drawer-close" aria-label="关闭" title="关闭">${icon('close')}</button></header><div class="match-drawer-body is-review" tabindex="0">${body}</div></section>`;
    document.body.append(drawer);
    state.drawerReturn = opener;
    drawer.querySelector('.match-drawer-close').focus({ preventScroll: true });
  }

  function materialReviewBody(task, source) {
    const attrs = `data-task="${esc(task.id)}" data-source="${esc(source.id)}"`;
    if (!source.provided) {
      const policy = publicPolicies().find(item => item.id === task.policyId);
      const note = policy?.application?.checklist.find(entry => `${policy.id}-${entry.id}` === source.id)?.note || '';
      const accept = '.doc,.docx,.txt,.md,.htm,.html,.pdf,.jpg,.jpeg,.png';
      return `<section class="review-file"><div class="review-file-row"><div class="review-file-main"><span class="review-file-label">原文</span><span class="review-file-none">还没有文件</span></div><div class="review-file-actions"><label class="chat-gap-upload">上传完整文件<input type="file" data-source-upload ${attrs} accept="${accept}" aria-label="上传${esc(source.name)}"></label><label class="chat-gap-upload">批量上传，AI 生成<input type="file" multiple data-source-generate ${attrs} accept="${accept}" aria-label="批量选择零散资料，AI 生成${esc(source.name)}"></label></div></div></section><section class="review-block is-lack"><h3>与政策差异</h3>${note ? `<p class="review-requirement"><b>政策要求：</b>${esc(note)}</p>` : ''}<p>上传或生成文件后，我再对照政策要求。</p></section><section class="review-ai" aria-label="AI 建议"><header class="review-ai-head"><span class="review-ai-mark" aria-hidden="true">${icon('spark')}</span><h3>AI 建议</h3></header><div class="review-ai-scroll" tabindex="0"><p class="review-ai-empty">有了文件后，这里会逐条列出原文、问题和修改建议。</p></div></section>`;
    }
    const review = reviewMaterial(task, source);
    const fileName = source.fileName || `${source.name}.doc`;
    const file = `<section class="review-file"><div class="review-file-row"><div class="review-file-main"><span class="review-file-label">原文</span><button type="button" class="review-file-link" data-action="mat-material-download" ${attrs} title="下载 ${esc(fileName)}">${icon('file')}<span>${esc(fileName)}</span></button></div><div class="review-file-actions"><label class="chat-gap-upload">重新上传<input type="file" data-source-upload ${attrs} accept=".doc,.docx,.txt,.md,.htm,.html,.pdf,.jpg,.jpeg,.png" aria-label="重新上传${esc(source.name)}"></label><button type="button" class="text-button review-file-delete" data-action="material-delete" ${attrs}>删除</button></div></div>${review.unreadable ? uploadThumb(task, source) : ''}</section>`;
    const lacks = review.unreadable ? [] : [...review.missing.map(word => `政策要求写明“${word}”，材料里还没有。`), ...(!review.hasRequirements && review.pending.length ? [`材料还有待补充的内容：${review.pending.join('、')}。`] : [])];
    const noneText = review.unreadable ? '读不到文字，暂时无法对照。' : review.hasRequirements ? '已对照政策列出的要点，没有发现差异。提交前再核对政策原文。' : '政策没有列出这份材料的具体要点，请对照政策原文核对。';
    const differences = `<section class="review-block is-lack"><h3>与政策差异</h3>${review.note ? `<p class="review-requirement"><b>政策要求：</b>${esc(review.note)}</p>` : ''}${lacks.length ? `<ul>${lacks.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : `<p>${esc(noneText)}</p>`}</section>`;
    const items = review.items || [];
    const rows = items.map((item, index) => `<li class="review-ai-item"><span class="review-ai-index">${index + 1}</span><dl><div><dt>原文</dt><dd class="is-original">${maskedHtml(item.original)}</dd></div><div><dt class="is-problem">问题</dt><dd>${esc(item.problem)}</dd></div><div class="is-suggestion"><dt>AI 建议</dt><dd>${maskedHtml(item.suggestion)}</dd></div></dl></li>`).join('');
    const content = review.unreadable ? '<p class="review-ai-empty">这份文件读不到文字。上传 Word（.docx）或文本文件后，才能给出建议。</p>' : items.length ? `<ol class="review-ai-list">${rows}</ol>` : '<p class="review-ai-empty">这份材料没有发现需要修改的地方。</p>';
    const download = items.length ? `<button type="button" class="review-ai-download" data-action="mat-advice-download" ${attrs}>${icon('download')}下载</button>` : '';
    const ai = `<section class="review-ai" aria-label="AI 建议"><header class="review-ai-head"><span class="review-ai-mark" aria-hidden="true">${icon('spark')}</span><h3>AI 建议</h3>${items.length ? `<small>${items.length} 条</small>` : ''}</header><div class="review-ai-scroll" tabindex="0">${content}</div>${download}</section>`;
    return file + differences + ai;
  }

  /* 抽屉里重新上传后，内容跟着换。 */
  function refreshMaterialReview(task, sourceId) {
    const drawer = document.querySelector('#match-drawer');
    const source = task?.sources.find(item => item.id === sourceId);
    if (!drawer || drawer.dataset.reviewSource !== sourceId || !source?.provided) return;
    drawer.querySelector('.match-drawer-body').innerHTML = materialReviewBody(task, source);
  }

  function forgetUpload(taskId, sourceId) {
    const list = mosaics.get(taskId);
    if (list) mosaics.set(taskId, list.filter(item => item.sourceId !== sourceId));
  }

  /* ---------- 上传图片时打码展示：缩到很小再放大，页面上不留清晰原图；只存在当前页面 ---------- */
  const mosaics = new Map();
  const mosaicWidth = 24;

  function rememberUpload(file, taskId = '', work = '', sourceId = '') {
    if (!/^image\//.test(file?.type || '') || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(file), image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = mosaicWidth;
      canvas.height = Math.max(1, Math.round(mosaicWidth * image.naturalHeight / image.naturalWidth));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const list = mosaics.get(taskId) || [];
      mosaics.set(taskId, [...list, { name: file.name, work, sourceId, url: canvas.toDataURL('image/png') }]);
      URL.revokeObjectURL(url);
      window.PolicyUI.refresh();
    };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }

  // 首页还没建项目时上传的图片，建项目后归到这个项目。
  function adoptUploads(taskId) {
    const pending = mosaics.get('');
    if (pending) { mosaics.set(taskId, pending); mosaics.delete(''); }
  }

  function uploadThumb(task, source) {
    const item = (mosaics.get(task.id) || []).filter(entry => entry.sourceId === source.id).at(-1);
    return item ? `<figure class="chat-upload-mosaic"><img src="${esc(item.url)}" alt="${esc(item.name)}，已打码"><figcaption>${esc(item.name)} · 已打码</figcaption></figure>` : '';
  }

  function uploadsMarkup(task, work) {
    const items = (mosaics.get(task?.id || '') || []).filter(item => !item.work || item.work === work);
    return items.map(item => `<div class="chat-message-row is-user"><span class="chat-message-avatar chat-message-user-avatar" aria-hidden="true">企</span><div class="chat-message-body"><figure class="chat-upload-mosaic"><img src="${esc(item.url)}" alt="${esc(item.name)}，已打码"><figcaption>${esc(item.name)} · 已打码</figcaption></figure></div></div>`).join('');
  }

  /* ---------- 首页：填完名称原地展开，确定或跳过后才建项目 ---------- */
  const homeIntake = { open: false, answers: {} };
  const openHomeIntake = () => { homeIntake.open = true; };

  function homeIntakeMarkup() {
    if (!homeIntake.open) return '';
    return `<div class="start-intake" data-home-intake>${questionFields(homeIntake.answers)}<div class="intake-foot"><p class="match-hint" aria-live="polite">${esc(hintText(homeIntake.answers))}</p><div class="intake-foot-actions"><button type="button" class="text-button" data-action="home-intake-finish">跳过</button><button type="button" class="button button-primary" data-action="home-intake-finish">确定 ${icon('arrow')}</button></div></div></div>`;
  }

  /* 首页快捷入口：先给企业名称和前几个选择器，都选了后面的问题再逐项展开。政策匹配多问所在地区，它直接影响匹配结果。 */
  const quickLead = (answers, withRegion) => [answers.industry, ...(withRegion ? [answers.region] : [])].filter(value => !value).length;
  const quickRevealed = (answers, withRegion) => quickLead(answers, withRegion) ? 1 : revealedCount(answers);
  const quickHint = (answers, withRegion) => {
    const left = questions.length - answeredCount(answers) + quickLead(answers, withRegion);
    return left ? `再选 ${left} 项，匹配更准` : '都选好了';
  };
  function regionField(answers) {
    const options = [...fieldOptions('region'), '其他地区'];
    return `<fieldset class="intake-question"><legend>所在地区</legend><div class="match-options">${options.map(option => `<label class="match-option"><input type="radio" name="region" value="${esc(option)}"${answers.region === option ? ' checked' : ''}><span>${esc(option)}</span></label>`).join('')}</div></fieldset>`;
  }
  function quickIntakeMarkup(name = '', withRegion = false) {
    const answers = homeIntake.answers;
    return `<div class="intake-name-row"><label for="start-company-name">企业名称</label><input id="start-company-name" name="companyName" type="text" maxlength="300" required autocomplete="organization" placeholder="输入企业名称" value="${esc(name)}"></div><div class="start-intake" data-home-intake>${withRegion ? regionField(answers) : ''}${industryField(answers)}${questionFields(answers, quickRevealed(answers, withRegion))}<div class="intake-foot"><p class="match-hint" aria-live="polite">${esc(quickHint(answers, withRegion))}</p><div class="intake-foot-actions"><button type="button" class="text-button" data-action="home-intake-finish">跳过</button><button type="button" class="button button-primary" data-action="home-intake-finish">确定 ${icon('arrow')}</button></div></div></div>`;
  }

  function finishHomeIntake() {
    const input = document.querySelector('#start-company-name');
    const name = input?.value.trim();
    if (!name) { window.PolicyUI.toast('请填写企业名称。'); input?.focus(); return; }
    const work = document.querySelector('#company-start-form')?.dataset.work || 'match';
    const task = S().createTask({ title: `${name} · 政策申报`, request: `为${name}查找适用政策并准备申报材料。`, company: { name, region: homeIntake.answers.region === '其他地区' ? '' : homeIntake.answers.region || '', industry: homeIntake.answers.industry || '' }, ...(work === 'assembly' ? { policyId: 'no-policy' } : {}), intake: { stage: 'fields', answers: { ...homeIntake.answers }, files: [] } });
    if (!task) { window.PolicyUI.toast('未能创建，请重试。'); return; }
    Object.assign(homeIntake, { open: false, answers: {} });
    window.PolicyUI.clearCompanyDraft();
    if (work === 'match') { startMatch(task); return; }
    setIntake(task, { stage: 'ready' });
    S().confirmWork(task.id, 'profile');
    window.PolicyUI.navigate('task', { task: task.id, work });
  }

  function revealNext(form, answers) {
    const quickForm = form.closest('.start-quick-form');
    const withRegion = Boolean(quickForm);
    const revealed = quickForm ? quickRevealed(answers, withRegion) : revealedCount(answers);
    const next = [...form.querySelectorAll('.intake-question[data-question]')].find((node, index) => index < revealed && node.hidden);
    if (next) {
      next.hidden = false;
      next.classList.add('is-new');
      next.scrollIntoView?.({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    const hint = form.querySelector('.match-hint');
    if (hint) hint.textContent = quickForm ? quickHint(answers, withRegion) : hintText(answers);
  }

  /* ---------- 解析动画 ---------- */
  function stageRows(group, answers) {
    return group.keys.map(key => `<div class="match-row"><span>${esc(labelOf(key))}</span><strong>${esc(answers[key] || '未填写')}</strong></div>`).join('');
  }

  function runningMarkup(task) {
    const answers = answersOf(task), files = filesOf(task).length;
    const stages = [...groups.map(group => ({ title: group.title, rows: stageRows(group, answers) })), { title: '比对政策库', rows: `<div class="match-row"><span>比对范围</span><strong>已收录公开政策 ${publicPolicies().length} 项</strong></div><div class="match-row"><span>企业资料</span><strong>${files ? `${files} 份` : '未提供'}</strong></div>` }];
    const card = `<div class="intake-card match-running"><div class="match-running-body"><div class="match-orb" aria-hidden="true"><span class="match-orb-ring"></span><span class="match-orb-ring"></span><span class="match-orb-core" data-orb-label>${state.stage ? '正在匹配中' : '开始匹配'}</span></div><ol class="match-stages" aria-live="polite">${stages.map((stage, index) => `<li class="match-stage" data-stage="${index}"${index > state.stage ? ' hidden' : ''}${index === state.stage ? ' data-state="active"' : ' data-state="done"'}><div class="match-stage-head"><h4>${esc(stage.title)}</h4><span class="match-stage-status" aria-hidden="true"></span></div><div class="match-stage-rows"><div>${stage.rows}</div></div></li>`).join('')}</ol></div></div>`;
    return assistantBubble(`我来帮「${task.company.name}」比对政策。`, card, 'match');
  }


  /* 抽屉里的政策卡：把原文里能确定的信息结构化，没有的不补。 */
  function policyCard(task, { policy, status, reasons }, first) {
    const checks = [...policy.conditions, ...(policy.applicationTimeNote ? [policy.applicationTimeNote] : [])];
    const tag = first ? '首选推荐' : { open: '正在申报', notice: '政策方向', closed: '已截止' }[status];
    const chosen = task.steps.match && task.policyId === policy.id;
    const keywords = [policy.supportType, policy.category, ...policy.industries.slice(0, 3)].filter(Boolean);
    const facts = [['支持方向', policy.supportType], ['适用地区', policy.region], ['申报时间', windowText(policy)], ['发布日期', policy.publishedAt]];
    const left = status === 'open' && policy.applicationStart <= today() || status === 'open' && !policy.applicationStart ? daysLeft(policy) : null;
    const scored = policyScore(task, policy);
    const side = scored ? `<span>匹配分</span><strong>${scored.level}</strong>` : left !== null ? `<span>距离截止</span><strong>${left}<small> 天</small></strong>` : `<span>申报状态</span><strong class="is-text">${{ open: '未开始', notice: '暂无窗口', closed: '已截止' }[status]}</strong>`;
    const list = (title, items) => items.length ? `<div><h4>${title}</h4><ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>` : '';
    return `<article class="match-policy is-full is-${status}${first ? ' is-first' : ''}"><div class="match-policy-main"><p class="match-policy-tag">${tag}</p><h3>${esc(policy.title)}</h3><p class="match-policy-keywords">${keywords.map(esc).join(' / ')}</p><p class="match-policy-summary">${esc(policy.summary)}</p><dl class="match-policy-facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></div><div class="match-policy-side">${side}${status === 'open' ? `<button type="button" class="button ${first ? 'button-primary' : 'button-secondary'}" data-action="match-apply" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">${chosen ? '已选这项政策' : '申报这项政策'} ${icon('arrow')}</button>` : ''}<a class="match-policy-source" href="${esc(policy.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看政策原文</a></div><div class="match-policy-columns">${list('命中原因', (() => { const all = hitReasons(task, { policy, status, reasons }); return all.length ? all : ['补充企业情况后会给出命中原因']; })())}${list('申报条件', checks)}${list('所需材料', policy.materials)}</div><p class="match-policy-agency"><span>发布部门</span>${esc(policy.agency)}</p></article>`;
  }

  function compactCard(task, item, first, relax) {
    const { policy, status } = item;
    const tag = first ? '首选推荐' : { open: '正在申报', notice: '政策方向', closed: '已截止' }[status];
    const chosen = task.steps.match && task.policyId === policy.id;
    const reason = hitReasons(task, item, relax).slice(0, 2).join('；') || '还没有可判断的信息，补充企业情况后会给出命中原因';
    const scored = policyScore(task, policy) ? ' has-score' : '';
    return `<article class="match-policy is-compact is-clickable is-${status}${first ? ' is-first' : ''}${chosen ? ' is-chosen' : ''}${scored}" data-type="${esc(policy.supportType || '')}"${typePick && policy.supportType !== typePick ? ' hidden' : ''}>${chosen ? `<span class="match-policy-check" role="img" aria-label="已选这项政策">${icon('check')}</span>` : ''}${scoreBadge(task, policy)}<p class="match-policy-tag">${tag}</p><h3><button type="button" class="match-policy-open" data-action="match-drawer" data-task="${esc(task.id)}" data-policy="${esc(policy.id)}">${esc(policy.title)}</button></h3><p class="match-policy-meta">${esc(policy.region)} · ${esc(windowText(policy))}</p><p class="match-policy-reason">${esc(reason)}</p>${viewButton(task, policy)}</article>`;
  }

  /* 政策类型筛选：按政策的支持方向分，和“仅看进行中”可以叠加。 */
  let typePick = '';
  const typeFilter = matches => {
    const types = [...new Set(matches.map(item => item.policy.supportType).filter(Boolean))];
    if (types.length < 2) return '';
    return `<div class="match-type-filter" role="group" aria-label="按政策类型筛选">${['', ...types].map(type => `<button type="button" class="nohit-chip" data-type-pick="${esc(type)}" aria-pressed="${typePick === type}">${type ? esc(type) : '全部类型'}</button>`).join('')}</div>`;
  };
  const applyTypeFilter = root => root?.querySelectorAll('.match-policy[data-type]').forEach(card => { card.hidden = Boolean(typePick) && card.dataset.type !== typePick; });
  document.addEventListener('click', event => {
    const chip = event.target instanceof Element && event.target.closest('[data-type-pick]');
    if (!chip) return;
    typePick = chip.dataset.typePick;
    const root = chip.closest('.match-result');
    root.querySelectorAll('[data-type-pick]').forEach(item => item.setAttribute('aria-pressed', String(item === chip)));
    applyTypeFilter(root);
  });

  /* 政策列表的“仅看进行中”：默认不勾选。 */
  let onlyOpen = false;
  const onlyOpenToggle = () => `<label class="match-only-open"><input type="checkbox" data-only-open${onlyOpen ? ' checked' : ''}><span>仅看进行中</span></label>`;
  document.addEventListener('change', event => {
    if (!(event.target instanceof Element) || !event.target.matches('[data-only-open]')) return;
    onlyOpen = event.target.checked;
    event.target.closest('.match-result')?.classList.toggle('only-open', onlyOpen);
  });

  /* 被过滤的政策（已截止，以及地区、行业不符）不展示，只留正在申报和政策方向。 */
  const visible = list => list.filter(item => item.status !== 'closed');

  /* 命中原因：按 PRD 8.2.3 的模板，从上到下挑，最多 2 条。只用已知信息，不说“一定能申请”。 */
  function hitReasons(task, { policy, status, reasons }, relax) {
    const out = [];
    if (relax) out.push(relax);
    const { region, industry } = factsOf(task);
    const metrics = policyMetrics(task, policy);
    metrics.filter(m => m.have !== null && m.met).forEach(m => out.push(`您有 ${m.have} ${metricUnit(m.unit)}${m.label}，达到政策要求的 ${m.need} ${metricUnit(m.unit)}`));
    const items = (policy.application?.checklist || []).filter(item => item.kind !== 'condition' && item.required !== false);
    const missing = items.filter(item => !task.sources?.some(source => source.id === `${policy.id}-${item.id}` && source.provided));
    if (items.length && !missing.length) out.push('申报材料已备齐，可以确认版本');
    else if (items.length && missing.length <= 2 && missing.length < items.length) out.push(`只差 ${missing.length} 份材料就能准备齐：${missing.map(item => item.label).join('、')}`);
    metrics.filter(m => m.have !== null && !m.met && m.need - m.have <= Math.max(1, Math.ceil(m.need / 3))).forEach(m => out.push(`您的${m.label}还差 ${m.need - m.have} ${metricUnit(m.unit)}就达到要求`));
    if (status === 'notice') out.splice(relax ? 1 : 0, 0, '暂未开放申报，可以提前准备');
    if (!relax) {
      if (region && policy.region === region) out.push(`政策面向${region}，与企业所在地一致`);
      else if (policy.region === '全国') out.push('全国范围的政策，不限地区');
      if (industry && policy.industries.includes(industry)) out.push(`您所在的${industry}属于政策支持行业`);
    }
    reasons.forEach(reason => { if (!/和你选的地区一致|全国范围的政策|在这项政策涉及的行业内/.test(reason)) out.push(reason); });
    return [...new Set(out)];
  }

  /* 放宽条件：地区只往上扩一级（市→省，本期没有区县），行业只看同一国标门类下的相邻行业。
     原型的政策地区只有省级和全国，所以“扩大地区范围”只在企业所在地是地级市时出现。 */
  const regionParent = { 杭州市: '浙江省', 宁波市: '浙江省', 深圳市: '广东省', 广州市: '广东省', 南京市: '江苏省', 苏州市: '江苏省' };
  const industryGroups = [
    { name: '国标门类 C 制造业', members: ['先进制造', '新能源', '生命健康'] },
    { name: '信息技术和科技服务', members: ['软件信息', '现代服务'] },
  ];
  const groupOf = industry => industryGroups.find(group => group.members.includes(industry));
  const neighborsOf = industry => (groupOf(industry)?.members || []).filter(item => item !== industry);
  const relaxText = applied => [applied.region && `地区扩大到${applied.region}`, applied.industry && `行业放宽到相邻的${applied.industry}`].filter(Boolean).join('、');

  /* ---------- 无命中：地区、行业对不上时不硬推政策，让用户按规则放宽条件或找人工客服 ---------- */
  const noHitViews = new Map();
  const noHitView = taskId => noHitViews.get(taskId) || { industry: '', region: '', applied: null, service: false };
  const setNoHitView = (taskId, patch) => noHitViews.set(taskId, { ...noHitView(taskId), ...patch });
  const openFits = facts => matchPolicies(facts).filter(item => item.status === 'open');
  const noHit = facts => (facts.region === '其他地区' && facts.industry === '其他行业') || !openFits(facts).length;

  function noHitRow(task, key, title, options, selected) {
    if (!options.length) return '';
    const chips = options.map(option => { const { value, label } = typeof option === 'string' ? { value: option, label: option } : option; return `<button type="button" class="nohit-chip" data-action="nohit-pick" data-task="${esc(task.id)}" data-key="${key}" data-value="${esc(value)}" aria-pressed="${selected === value}">${esc(label)}</button>`; }).join('');
    return `<fieldset class="intake-question nohit-row"><legend>${title}</legend><div class="match-options">${chips}</div></fieldset>`;
  }

  function noHitCard(task, role) {
    const facts = factsOf(task), view = noHitView(task.id), id = esc(task.id);
    const { applied } = view;
    const pool = applied ? visible(matchPolicies({ ...facts, ...(applied.region ? { region: applied.region } : {}), ...(applied.industry ? { industry: applied.industry } : {}) })) : [];
    const items = role === 'assembly' ? pool.filter(item => item.status === 'open') : pool;
    const open = items.filter(item => item.status === 'open').length;
    const parent = regionParent[facts.region];
    const group = groupOf(facts.industry);
    const rows = noHitRow(task, 'region', '扩大地区范围', parent ? [{ value: parent, label: `${facts.region} → ${parent}` }] : [], view.region) + noHitRow(task, 'industry', group ? `看相邻行业（同属${group.name}）` : '看相邻行业', neighborsOf(facts.industry), view.industry);
    const canConfirm = view.industry || view.region || applied;
    const cond = applied ? relaxText(applied) : '';
    const heading = !items.length ? `按「${cond}」还是没有合适的政策，可以问问人工客服` : `以下政策根据「${cond}」查到${open ? `，${open} 项正在申报` : '，暂无正在申报的，可以先了解'}`;
    const results = applied ? `<div class="nohit-results"><div class="match-result-bar"><p class="match-result-heading">${heading}</p>${role === 'match' && items.length ? onlyOpenToggle() : ''}</div>${items.length ? `<p class="nohit-note">这些政策的${applied.region ? '地区' : ''}${applied.region && applied.industry ? '和' : ''}${applied.industry ? '行业' : ''}和企业情况不完全一致，申报前请核对要求。</p><div class="match-policy-grid">${items.map(item => compactCard(task, item, false, `按${cond}查到，申报前请核对${[applied.region && '地区', applied.industry && '行业'].filter(Boolean).join('和')}要求`)).join('')}</div>` : ''}</div>` : '';
    const service = view.service
      ? '<p class="nohit-service-done" role="status" tabindex="-1">已通知人工客服，稍后会联系您。</p>'
      : `<p>需要人帮您看看？</p><button type="button" class="button button-secondary" data-action="nohit-service" data-task="${id}">联系人工客服</button>`;
    return `<div class="intake-card match-result match-nohit${onlyOpen ? ' only-open' : ''}"><p id="match-result-heading" class="match-result-heading" tabindex="-1">${rows ? '可以放宽条件再看看' : '企业所在地和行业都没有可以放宽的范围'}</p>${rows ? `<div class="nohit-rows">${rows}</div><div class="nohit-confirm">` : '<div hidden>'}<button type="button" class="button button-primary" data-action="nohit-confirm" data-task="${id}"${canConfirm ? '' : ' disabled'}>确定</button></div>${results}<div class="nohit-service">${service}</div></div>`;
  }

  function resultMarkup(task) {
    if (noHit(factsOf(task))) return assistantBubble('暂未找到完全匹配的政策', noHitCard(task, 'match'), 'match');
    const matches = visible(matchPolicies(factsOf(task)));
    const openCount = matches.filter(item => item.status === 'open').length;
    // 同一状态内按匹配分从高到低（PRD 8.1.4），待确认排后面。
    const statusOrder = { open: 0, notice: 1, closed: 2 };
    matches.sort((x, y) => statusOrder[x.status] - statusOrder[y.status] || (policyScore(task, y.policy)?.score ?? -1) - (policyScore(task, x.policy)?.score ?? -1));
    const pickIndex = matches.findIndex(item => item.status === 'open' && (policyScore(task, item.policy)?.score ?? -1) >= FIRST_PICK_MIN);
    const cards = matches.map((item, index) => compactCard(task, item, index === pickIndex)).join('');
    const card = `<div class="intake-card match-result${onlyOpen ? ' only-open' : ''}"><div class="match-result-bar"><p id="match-result-heading" class="match-result-heading" tabindex="-1">有 ${openCount} 项政策正在申报</p>${onlyOpenToggle()}</div>${typeFilter(matches)}<div class="match-policy-grid">${cards}</div></div>`;
    return assistantBubble(`「${task.company.name}」比对完了。`, card, 'match');
  }

  /* 从申报辅助进来还没选政策：列出正在申报的政策，选好后才知道要备哪些材料。 */
  function assemblyPicker(task) {
    if (noHit(factsOf(task))) return assistantBubble('暂未找到完全匹配的政策', noHitCard(task, 'assembly'), 'assembly');
    const cards = openFits(factsOf(task)).map((item, index) => compactCard(task, item, index === 0)).join('');
    return assistantBubble(`请选择「${task.company.name}」要申报的政策，选好后我按它列出要准备的材料。`, `<div class="intake-card match-result"><div class="match-policy-grid">${cards}</div></div>`, 'assembly');
  }

  /* 全部政策放在右侧抽屉，对话里只留前三项。 */
  function closeDrawer() {
    const drawer = document.querySelector('#match-drawer');
    if (!drawer) return;
    drawer.remove();
    if (state.drawerReturn?.isConnected) state.drawerReturn.focus({ preventScroll: true });
    state.drawerReturn = null;
  }

  function openDrawer(task, opener) {
    closeDrawer();
    const policy = publicPolicies().find(item => item.id === opener.dataset.policy);
    if (!policy) return;
    serviceBatch = 0;
    interpretEditKey = '';
    // 记下正在看的政策，之后在对话里追问就按它回答。
    if (task.id) S().updateTask(task.id, { interpretPolicyId: policy.id });
    else guest.policyId = policy.id;
    const current = task.id ? S().getTask(task.id) : guestTask();
    const drawer = document.createElement('div');
    drawer.id = 'match-drawer';
    drawer.className = 'match-drawer';
    drawer.innerHTML = `<button type="button" class="match-drawer-scrim" data-action="match-drawer-close" aria-label="关闭政策解读" tabindex="-1"></button><section class="match-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="match-drawer-title"><header><h2 id="match-drawer-title">政策解读</h2><button type="button" class="icon-button match-drawer-close" data-action="match-drawer-close" aria-label="关闭" title="关闭">${icon('close')}</button></header><div class="match-drawer-body" tabindex="0">${interpretCard(current, policy)}</div>${interpretFooter(current,policy)}</section>`;
    document.body.append(drawer);
    state.drawerReturn = opener;
    drawer.querySelector('.match-drawer-close').focus({ preventScroll: true });
  }

  /* 企业画像里的可申报数量：匹配过才有。 */
  function openCount(task) {
    if (task?.intake?.stage !== 'ready') return undefined;
    const facts = factsOf(task);
    return noHit(facts) ? 0 : openFits(facts).length;
  }

  function chatInner(task) {
    return state.taskId === task.id && state.phase === 'running' ? runningMarkup(task) : resultMarkup(task);
  }

  /* 匹配顾问的对话内容。还没收集完时，先交回资料助理。 */
  function matchChatMarkup(task) {
    if (!task?.intake) return '';
    // 企业信息在这里收集，收完接着比对。
    if (task.intake.stage !== 'ready') return intakeMarkup(task);
    return `<div id="match-app" class="match-app">${chatInner(task)}</div>`;
  }

  const matchPending = task => Boolean(task?.intake) && !task.steps.match;

  function followChat() {
    window.PolicyChat.restoreView({ followLatest: true });
  }

  function showResult() {
    state.phase = 'result';
    state.timer = 0;
    if (!document.querySelector('#match-app')) return;
    const settle = () => {
      window.PolicyUI.refresh();
      followChat();
      document.querySelector('#match-result-heading')?.focus({ preventScroll: true });
    };
    if (typeof document.startViewTransition !== 'function' || reducedMotion()) { settle(); return; }
    // 页面不可见时过渡会被跳过，内容仍会更新，不算错误。
    const transition = document.startViewTransition(settle);
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
  }

  function advance() {
    if (state.stage >= groups.length) { showResult(); return; }
    state.stage += 1;
    const root = document.querySelector('#match-app');
    root?.querySelectorAll('.match-stage').forEach((node, index) => {
      node.hidden = index > state.stage;
      node.dataset.state = index === state.stage ? 'active' : 'done';
    });
    const orb = root?.querySelector('[data-orb-label]');
    if (orb) orb.textContent = '正在匹配中';
    state.timer = window.setTimeout(advance, stageDelay);
  }

  function setIntake(task, patch, extra = {}) {
    return S().updateTask(task.id, { ...extra, intake: { ...task.intake, ...patch } });
  }

  const resetSteps = { match: false, diagnosis: false, assembly: false, review: false };

  function refreshChat() {
    window.PolicyUI.refresh();
    window.PolicyChat.restoreView({ followLatest: true });
  }

  function startMatch(task) {
    const saved = setIntake(task, { stage: 'ready' });
    if (!saved) { window.PolicyUI.toast('资料未能保存，请重试。'); return; }
    S().confirmWork(task.id, 'profile');
    window.clearTimeout(state.timer);
    Object.assign(state, { taskId: task.id, phase: reducedMotion() ? 'result' : 'running', stage: 0, timer: 0 });
    if (state.phase === 'running') state.timer = window.setTimeout(advance, stageDelay);
    window.PolicyUI.navigate('task', { task: task.id, work: 'match' });
  }

  function handleClick(target) {
    const { action } = target.dataset;
    if (!['interpret-services-refresh','interpret-todo', 'interpret-apply', 'portrait-edit', 'portrait-cancel', 'portrait-save', 'home-intake-finish', 'intake-edit', 'intake-start', 'intake-remove-file', 'intake-result', 'match-chat', 'match-apply', 'match-drawer', 'match-drawer-close', 'nohit-pick', 'nohit-confirm', 'nohit-service'].includes(action)) return false;
    if (action === 'match-drawer-close') { closeDrawer(); return true; }
    if (action === 'home-intake-finish') { finishHomeIntake(); return true; }
    if (action === 'interpret-services-refresh') {
      serviceBatch = (serviceBatch + 1) % Math.ceil(patentServices.length / serviceBatchSize);
      document.querySelector('.interpret-service-grid').innerHTML = serviceCards();
      return true;
    }
    if(action==='interpret-todo') {
      const task=S().getTask(target.dataset.task),policy=publicPolicies().find(item=>item.id===target.dataset.policy);
      if(!task){closeDrawer();window.PolicyUI.navigate('dashboard');window.PolicyUI.toast('先填写企业名称，再补充企业资料。');return true;}
      if(!policy)return true;
      const key=target.dataset.key,row=comparisonRows(task,policy).find(item=>item.key===key);if(!row)return true;
      const panel=document.querySelector('#interpret-supplement');
      interpretEditKey=key==='materials'?'':key;renderComparison(task,policy);
      panel.innerHTML=key==='materials'?materialsMarkup(task,policy):'';
      if(key==='materials'){panel.scrollIntoView({block:'nearest',behavior:reducedMotion()?'instant':'smooth'});panel.querySelector('button')?.focus({preventScroll:true});return true;}
      const editor=document.querySelector('#interpret-field');editor.focus({preventScroll:true});editor.select();editor.scrollIntoView({block:'nearest',inline:'nearest'});return true;
    }
    if (!target.dataset.task && ['match-drawer', 'interpret-apply'].includes(action)) { handleGuest(action, target); return true; }
    const task = S().getTask(target.dataset.task);
    if (!task) return true;
    if (action === 'match-drawer') { openDrawer(task, target); return true; }
    if (action === 'nohit-pick') {
      const { key, value } = target.dataset, view = noHitView(task.id), next = view[key] === value ? '' : value;
      setNoHitView(task.id, { [key]: next });
      target.parentElement.querySelectorAll('.nohit-chip').forEach(chip => chip.setAttribute('aria-pressed', String(chip === target && Boolean(next))));
      const current = noHitView(task.id);
      target.closest('.match-nohit').querySelector('[data-action="nohit-confirm"]').disabled = !(current.industry || current.region || current.applied);
      return true;
    }
    if (action === 'nohit-confirm') {
      const view = noHitView(task.id);
      setNoHitView(task.id, { applied: view.industry || view.region ? { industry: view.industry, region: view.region } : null });
      window.PolicyUI.refresh();
      document.querySelector('[data-action="nohit-confirm"]')?.focus({ preventScroll: true });
      document.querySelector('.nohit-results')?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      return true;
    }
    if (action === 'nohit-service') {
      setNoHitView(task.id, { service: true });
      window.PolicyUI.refresh();
      document.querySelector('.nohit-service-done')?.focus({ preventScroll: true });
      return true;
    }
    if (action === 'interpret-apply') {
      const picked = publicPolicies().find(item => item.id === target.dataset.policy);
      if (!picked || !S().updateTask(task.id, { ...chooseStep(task, picked), interpretPolicyId: picked.id })) { window.PolicyUI.toast('未能保存，请重试。'); return true; }
      closeDrawer();
      window.PolicyUI.navigate('task', { task: task.id, work: hasNoTemplate(picked) ? 'guidance' : 'assembly' });
      return true;
    }
    if (action === 'portrait-edit') { portraitEditTask = task.id; swapPortrait(task); document.querySelector('#portrait-name')?.focus({ preventScroll: true }); return true; }
    if (action === 'portrait-cancel') { portraitEditTask = ''; swapPortrait(task); return true; }
    if (action === 'portrait-save') { savePortrait(task); return true; }
    if (action === 'intake-result') { window.PolicyUI.navigate('task', { task: task.id, work: 'match' }); return true; }
    if (action === 'intake-edit') {
      setIntake(task, task.intake ? { stage: 'fields' } : { stage: 'fields', answers: {}, files: [] });
      refreshChat();
      return true;
    }
    if (action === 'intake-start') { startMatch(task); return true; }
    if (action === 'intake-remove-file') {
      setIntake(task, { files: filesOf(task).filter(file => file.id !== target.dataset.file) });
      refreshChat();
      return true;
    }
    if (action === 'match-chat') {
      closeDrawer();
      setIntake(task, task.intake ? { stage: 'fields' } : { stage: 'fields', answers: {}, files: [] });
      window.PolicyUI.navigate('task', { task: task.id, work: 'match' });
      return true;
    }
    const policy = publicPolicies().find(item => item.id === target.dataset.policy);
    if (!policy) return true;
    closeDrawer();
    if (!S().updateTask(task.id, chooseStep(task, policy))) {
      window.PolicyUI.toast('未能选择这项政策，请重试。');
      return true;
    }
    window.PolicyUI.navigate('task', { task: task.id, work: hasNoTemplate(policy) ? 'guidance' : 'assembly' });
    return true;
  }

  /* 选完一项就露出下一项；只改动相关节点，已选项和键盘焦点都不受影响。 */
  document.addEventListener('change', event => {
    const input = event.target;
    if (input?.id === 'intake-files') {
      const task = S().getTask(input.dataset.task);
      if (!task) return;
      const added = Array.from(input.files || []).map((file, index) => ({ id: `file-${Date.now()}-${index}`, name: file.name, size: file.size }));
      Array.from(input.files || []).forEach(file => rememberUpload(file, task.id, input.closest('#adviser-chat-form')?.dataset.work || ''));
      if (added.length) { S().updateTask(task.id, { intake: { stage: 'ready', answers: {}, ...task.intake, files: [...filesOf(task), ...added].slice(-20) } }); refreshChat(); window.PolicyUI.toast('已上传。'); }
      return;
    }
    if (input?.id === 'intake-name') {
      const task = S().getTask(input.dataset.task), name = input.value.trim();
      if (!task) return;
      if (!name) { input.value = task.company.name; window.PolicyUI.toast('企业名称不能为空。'); return; }
      if (name === task.company.name) return;
      const title = task.title === `${task.company.name} · 政策申报` ? `${name} · 政策申报` : task.title;
      if (!S().updateTask(task.id, { title, company: { name }, steps: resetSteps })) { window.PolicyUI.toast('企业名称未能保存，请重试。'); return; }
      window.PolicyUI.refresh();
      return;
    }
    const home = input?.closest?.('[data-home-intake]');
    if (input?.type === 'radio' && home) {
      homeIntake.answers[input.name] = input.value;
      revealNext(home, homeIntake.answers);
      return;
    }
    const form = input?.closest?.('.intake-form');
    if (input?.type !== 'radio' || !form) return;
    const task = S().getTask(form.dataset.task);
    if (!task) return;
    const answers = { ...answersOf(task), [input.name]: input.value };
    setIntake(task, { answers });
    // 画像跟着选择实时更新，不重绘对话。
    const portrait = document.querySelector('.workspace-summary');
    if (portrait) portrait.outerHTML = window.PolicyWorkspace.portraitMarkup(S().getTask(task.id));
    revealNext(form, answers);
  });

  document.addEventListener('keydown', event => {
    const drawer = document.querySelector('#match-drawer');
    if (!drawer) return;
    // 编辑中：回车和 Tab 保存，Esc 放弃修改、只退出编辑。
    if (event.target instanceof Element && event.target.id === 'interpret-field' && ['Enter','Escape','Tab'].includes(event.key)) {
      if (event.key !== 'Tab') event.preventDefault();
      if (event.key === 'Escape') cancelInterpretEdit(); else commitInterpretEdit(true);
      return;
    }
    if (event.key === 'Escape') { closeDrawer(); return; }
    if (event.key !== 'Tab') return;
    const items = [...drawer.querySelectorAll('.match-drawer-panel button:not([disabled]),.match-drawer-panel a,.match-drawer-panel input,.match-drawer-panel select,.match-drawer-panel summary,.match-drawer-panel [tabindex="0"]')];
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (!drawer.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  });
  window.addEventListener('hashchange', closeDrawer);
  // 编辑中点抽屉里的按钮或链接：先存再执行，避免保存重绘时把这次点击吞掉。
  document.addEventListener('focusout', event => { if (event.target instanceof Element && event.target.id === 'interpret-field') commitInterpretEdit(); });
  document.addEventListener('mousedown', event => {
    if (interpretEditKey && event.target instanceof Element && event.target.closest('#match-drawer button,#match-drawer a')) event.preventDefault();
  }, true);
  document.addEventListener('click', event => {
    if (!interpretEditKey || !(event.target instanceof Element) || event.target.id === 'interpret-field' || !document.querySelector('#interpret-field')) return;
    const link = event.target.closest('a[href]');
    commitInterpretEdit();
    if (link && !link.isConnected) window.open(link.href, '_blank', 'noopener');
  }, true);

  window.PolicyMatch = Object.freeze({ resetGuest, noTemplateNotice, quickIntakeMarkup, assemblyPicker, refreshMaterialReview, forgetUpload, closeDrawer, handleClick, intakeActive, intakeMarkup, matchChatMarkup, matchPending, openCount, composerAttach, questions, understanding, beginPortrait, portraitLoading, portraitEditing, portraitEditor, scoreText, openMaterialReview, reviewMaterial, materialAdvice, maskedHtml, companyRows, policyMetrics, openHomeIntake, homeIntakeMarkup, rememberUpload, adoptUploads, uploadsMarkup, interpretMarkup, interpretPicking, guestMarkup, guestAsk, finishGuest, applicationIntro, applicationNote, guidanceMarkup, guidanceDetail, policyDetail, versionReview });
})();
