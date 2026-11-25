(function () {
  'use strict';

  const workflow = PrintWorkflow;
  const department = document.body.dataset.department;
  const $ = id => document.getElementById(id);
  const outgoing = Object.entries(workflow.interfaces).filter(([, definition]) =>
    definition.from === department && !definition.internal);
  const fields = {
    orderId: ['注文ID'], requestId: ['依頼ID'], proofId: ['校正ID'],
    priority: ['優先区分', ['通常', '特急']],
    product: ['品名'], paper: ['用紙'], quantity: ['部数', 'number'],
    dueDate: ['希望納期', 'date'], source: ['受注経路', ['店頭', '電話', 'メール']], 
    reason: ['理由'], version: ['版番号', 'number'],
    instruction: ['確認事項'], responseDueDate: ['回答期限', 'date'],
    receivedAt: ['受信日', 'date'],
    proofDecision: ['校正回答', ['承認', '修正依頼']], comment: ['修正コメント'],
    decision: ['依頼回答', ['承認', '却下']], confirmedDueDate: ['確定納期', 'date'],
    stage: ['工程', workflow.stages], expectedDate: ['完了見込み日', 'date'],
    completedDate: ['完成日', 'date'], goodQuantity: ['良品部数', 'number'],
    shortageQuantity: ['不足部数', 'number']
  };
  let events = [];
  let state = workflow.buildState(events);

  function element(tag, content) {
    const item = document.createElement(tag);
    if (content !== undefined) item.textContent = content;
    return item;
  }

  function option(value, label) {
    const item = element('option', label);
    item.value = value;
    return item;
  }

  function select(name, options) {
    const input = element('select');
    input.name = name;
    const placeholder = option('', options.length ? '選択してください' : '対象データがありません');
    placeholder.disabled = true;
    placeholder.selected = true;
    input.append(placeholder, ...options.map(([value, label]) => option(value, label)));
    return input;
  }

  function show(message, error = false) {
    $('message').textContent = message;
    $('message').dataset.error = String(error);
  }

  function localDate() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function identifier(prefix) {
    return prefix + '-' + Array.from(crypto.getRandomValues(new Uint32Array(3)), number =>
      number.toString(36).padStart(7, '0')).join('');
  }

  function orderChoices(type) {
    const orders = [...state.orders.values()];
    if (type === 'reply') {
      return orders.filter(order => [...state.requests.values()].some(request =>
        request.orderId === order.id && !request.answer));
    }
    return orders.filter(workflow.availableOrder);
  }

  function requestChoices(type, order) {
    return [...state.requests.values()]
      .filter(request => order && request.orderId === order.id)
      .filter(request => type === 'received' ? request.type === 'order' && !request.received :
        type === 'reply' ? !request.answer :
        ['order', 'additional'].includes(request.type) && request.answer === '承認' && !request.finished)
      .map(request => [request.requestId, workflow.interfaces[request.type].name + ' · ' +
        (type === 'finish' ? request.targetQuantity + '部 · ' : '') + request.requestId]);
  }

  function proofChoices(order) {
    return [...state.proofs.values()].filter(proof => order && proof.orderId === order.id && !proof.answer)
      .map(proof => [proof.proofId, '第' + proof.version + '版 · ' + proof.instruction]);
  }

  function automaticField(type, field) {
    return field === 'updatedAt' || (type === 'order' && field === 'orderId') ||
      (type === 'received' && field === 'receivedAt') ||
      (['order', 'change', 'cancel', 'additional'].includes(type) && field === 'requestId') ||
      (type === 'proof' && field === 'proofId');
  }

  // 全角数字・全角ハイフンなどを半角にそろえる(数値欄・日付欄の入力用)
  function toHalfWidth(value) {
    return String(value)
      .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/[－ー−‐]/g, '-')
      .trim();
  }

  const numericFields = ['quantity', 'version', 'goodQuantity', 'shortageQuantity'];


  function inputFor(type, field, order) {
    const [, kind] = fields[field];
    if (field === 'orderId') {
      return select(field, orderChoices(type).map(item =>
        [item.id, item.product + ' · ' + item.quantity + '部 · 納期 ' + item.dueDate + ' · ' + item.id]));
    }
    if (field === 'requestId') return select(field, requestChoices(type, order));
    if (field === 'proofId') return select(field, proofChoices(order));
    if (Array.isArray(kind)) {
      const input = select(field, kind.map(value => [value, value]));
      if (field === 'priority') input.value = '通常';
      return input;
    }

    const input = element(field === 'comment' || field === 'instruction' ? 'textarea' : 'input');
    input.name = field;
    if (input.tagName === 'INPUT') {
      if (numericFields.includes(field)) {
        input.type = 'text';
        input.inputMode = 'numeric';
        input.pattern = '[0-9０-９]+';
        input.title = '半角または全角の数字で入力してください';
      } else {
        input.type = kind || 'text';
      }
    }
    // if (input.type === 'number') {
    //  input.min = ['goodQuantity', 'shortageQuantity'].includes(field) ? '0' : '1';
    //  input.step = '1';
    //}
    if (field === 'completedDate') input.value = localDate();
    if (field === 'version') {
      const last = [...state.proofs.values()].filter(proof => order && proof.orderId === order.id).at(-1);
      input.value = last ? Number(last.version) + 1 : 1;
    }
    if (type === 'change' && order && ['paper', 'quantity', 'dueDate'].includes(field)) {
      input.value = order[field];
    }
    return input;
  }

  function renderForm(selectedOrder = '') {
    const type = $('operation').value;
    const definition = workflow.interfaces[type];
    const order = state.orders.get(selectedOrder);
    const formFields = $('fields');
    formFields.replaceChildren();

    if (type === 'order') {
      const copyLabel = element('label');
      copyLabel.className = 'copy-source';
      const copySelect = element('select');
      copySelect.id = 'copy-order';
      copySelect.append(option('', 'コピー元を選択（任意）'),
        ...[...state.orders.values()].reverse().map(item =>
          option(item.id, item.product + ' · ' + item.quantity + '部 · 納期 ' + item.dueDate)));
      copyLabel.append(element('span', '前回の注文をコピー'), copySelect);
      copySelect.addEventListener('change', () => {
        const source = state.orders.get(copySelect.value);
        if (!source) return;
        for (const [field, value] of [
          ['product', source.product],
          ['paper', source.paper],
          ['quantity', String(source.quantity)],
          ['dueDate', source.dueDate]
        ]) {
          const input = formFields.querySelector('[name="' + field + '"]');
          if (input) input.value = value;
        }
        formFields.querySelector('[name="quantity"]').focus();
      });
      formFields.append(copyLabel);
    }

    for (const field of definition.fields) {
      if (automaticField(type, field)) continue;
      const label = element('label');
      const input = inputFor(type, field, order);
      input.required = !['comment', 'confirmedDueDate'].includes(field) &&
        !(field === 'reason' && type === 'reply');
      if (field === 'orderId' && selectedOrder) input.value = selectedOrder;
      if (field === 'orderId') input.addEventListener('change', () => {
        renderForm(input.value);
        formFields.querySelector('[name="orderId"]').focus();
      });
      label.append(element('span', fields[field][0] + (input.required ? ' *' : '')), input);
      formFields.append(label);
    }
    $('action-help').textContent = type === 'order' ? '注文IDと依頼IDは自動で発行します。' :
      '対象の注文を選択してください。関連する依頼や校正は注文を選ぶと表示されます。';
    $('save-event').disabled = type !== 'order' && orderChoices(type).length === 0;
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const link = element('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function eventDownload(event) {
    download(event.type + '-' + event.orderId + '-' + event.eventId + '.csv',
      workflow.exportExchange(event.type, [event]));
  }

  function statusOf(order) {
    const request = state.requests.get(order.originalRequestId);
    if (order.cancelled) return 'キャンセル済み';
    if (!order.approved) {
      if (request.answer === '却下') return '製造依頼却下';
      if (request.received) return '製造部受信済み・承認待ち';
      return '製造部受信待ち';
    }
    if (order.initialFinished) return order.goodQuantity < order.quantity ? '完了・不足あり' : '完了';
    return order.progress || '製造承認済み';
  }

  function rowMessage(tableBody, columns, message) {
    const row = element('tr');
    const cell = element('td', message);
    cell.colSpan = columns;
    cell.className = 'empty';
    row.append(cell);
    tableBody.append(row);
  }

  function delayFollowupCell(order) {
    if (!order.delayReason) return element('td', '—');

    const cell = element('td');
    const details = element('details');
    const summary = element('summary', '顧客連絡: ' +
      (order.customerContacted ? '連絡済み' : '未連絡') + ' · 申し送り ' +
      order.delayFollowups.length + '件');
    details.append(summary);

    for (const followup of order.delayFollowups) {
      const note = element('p');
      note.append(element('strong', followup.owner + ' · ' + followup.updatedAt.slice(0, 10)),
        document.createElement('br'), element('span', followup.handoff));
      details.append(note);
    }

    const form = element('form');
    form.className = 'delay-followup';
    const contactedLabel = element('label');
    const contacted = element('input');
    contacted.type = 'checkbox';
    contacted.name = 'customerContacted';
    contacted.checked = order.customerContacted;
    contactedLabel.append(contacted, element('span', '顧客へ連絡済み'));

    const ownerLabel = element('label');
    const owner = element('input');
    owner.name = 'owner';
    owner.required = true;
    owner.placeholder = '担当者名';
    ownerLabel.append(element('span', '担当者'), owner);

    const handoffLabel = element('label');
    const handoff = element('textarea');
    handoff.name = 'handoff';
    handoff.required = true;
    handoff.placeholder = '顧客への連絡内容や次の対応';
    handoffLabel.append(element('span', '申し送り'), handoff);

    const save = element('button', '申し送りを記録');
    save.type = 'submit';
    form.append(contactedLabel, ownerLabel, handoffLabel, save);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const item = {
        eventId: identifier('EV'), type: 'delayFollowup', orderId: order.id,
        owner: values.owner, handoff: values.handoff,
        customerContacted: contacted.checked ? '連絡済み' : '未連絡',
        updatedAt: new Date().toISOString()
      };
      try {
        events = workflow.mergeEvents(events, [item]).events;
        refresh();
        show(order.product + 'の遅延対応を記録しました。');
      } catch (error) {
        show(error.message, true);
      }
    });
    details.append(form);
    cell.append(details);
    return cell;
  }

  function renderOrders() {
    const list = $('orders');
    const keyword = $('order-search').value.trim().toLowerCase();

    list.replaceChildren();
    const todayOnly = $('today-only').checked;
    const visibleOrders = [...state.orders.values()].filter(order =>
      !todayOnly || order.dueDate === localDate());
    for (const order of visibleOrders.reverse()) {
      const row = element('tr');

      const copyButton = element('button', order.id);
      copyButton.type = 'button';
      copyButton.className = 'copy-order-id';
      copyButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(order.id);
          copyButton.textContent = 'コピーしました！';
          setTimeout(() => {
            copyButton.textContent = order.id;
          }, 1200);
        } catch {
          alert('コピーに失敗しました。');
        }
      });

      const values = [order.product, order.paper, order.quantity + '部', order.dueDate,
        statusOf(order), order.proofStatus || '—', order.expectedDate || '—',
        order.delayReason || '—', order.initialFinished || order.goodQuantity ? order.goodQuantity + '部' : '—'];
      const idCell = element('td');
      idCell.append(copyButton);

      row.append(idCell, ...values.map(value => element('td', value)));
      list.append(row);
    }
    if (!list.children.length) {
      rowMessage(list, 10, todayOnly ? '今日が納期の注文はありません。' : '注文がありません。');
    }
    $('order-count').textContent = visibleOrders.length + '件';
  }

  function renderHistory() {
    const list = $('history');
    list.replaceChildren();
    for (const event of [...events].reverse()) {
      const definition = workflow.interfaces[event.type];
      const sent = definition.from === department;
      const row = element('tr');
      const detail = element('details');
      detail.append(element('summary', '内容を見る'));
      const metadata = element('dl');
      for (const field of definition.fields) {
        metadata.append(element('dt', fields[field]?.[0] || '更新日時'), element('dd', event[field] || '—'));
      }
      detail.append(metadata);
      const detailCell = element('td');
      detailCell.append(detail);
      const actionCell = element('td');
      if (sent && !definition.internal) {
        const button = element('button', 'CSVを書き出す');
        button.type = 'button';
        button.className = 'secondary';
        button.addEventListener('click', () => eventDownload(event));
        actionCell.append(button);
      } else {
        actionCell.textContent = '—';
      }
      row.append(element('td', definition.internal ? '社内' : sent ? '送信側' : '受信側'), element('td', definition.name),
        element('td', event.orderId), detailCell, actionCell);
      list.append(row);
    }
    if (!list.children.length) rowMessage(list, 5, 'やり取りはまだありません。');
  }

  function refresh() {
    state = workflow.buildState(events);
    renderOrders();
    renderHistory();
    renderForm();
  }

  $('operation').append(...outgoing.map(([type, definition]) => option(type, definition.name)));
  $('operation').addEventListener('change', () => renderForm());
  $('today-only').addEventListener('change', renderOrders);

  // 注文検索
  $('order-search').addEventListener('input', renderOrders);

  // 検索内容のクリア
  $('clear-search').addEventListener('click', () => {
    $('order-search').value = '';
    renderOrders();
    $('order-search').focus();
  });

  $('entry').addEventListener('submit', event => {
    event.preventDefault();
    const type = $('operation').value;
    const data = Object.fromEntries(new FormData($('entry')));
    for (const field of numericFields) {
      if (typeof data[field] === 'string') data[field] = toHalfWidth(data[field]);
    }
    const item = { eventId: identifier('EV'), type, ...data };
    if (type === 'order') item.orderId = identifier('ORD');
    if (['order', 'change', 'cancel', 'additional'].includes(type)) item.requestId = identifier('REQ');
    if (type === 'proof') item.proofId = identifier('PRF');
    if (type === 'progress') item.updatedAt = new Date().toISOString();
    if (type === 'received') item.receivedAt = localDate();

    try {
      events = workflow.mergeEvents(events, [item]).events;
      refresh();
      eventDownload(item);
      show(workflow.interfaces[type].name + 'を登録し、CSVを書き出しました。');
    } catch (error) {
      show(error.message, true);
    }
  });

  $('incoming').addEventListener('change', async event => {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    input.disabled = true;
    try {
      const text = await file.text();
      const result = workflow.mergeEvents(events, workflow.readExchange(text, department));
      events = result.events;
      refresh();
      show(file.name + ' を取り込みました。新規 ' + result.accepted + ' 件、取り込み済み ' + result.skipped + ' 件。');
    } catch (error) {
      show('取り込みを中止しました。' + error.message, true);
    } finally {
      input.disabled = false;
      input.value = '';
    }
  });

  $('save-backup').addEventListener('click', () => {
    download(department + '-backup-' + localDate() + '.csv', workflow.exportBackup(department, events));
    show('台帳を保存しました。再開時は「台帳を開く」を使ってください。');
  });

  $('backup').addEventListener('change', async event => {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    try {
      const saved = workflow.readBackup(department, await file.text());
      if (events.length && !confirm('現在の台帳を置き換えますか？')) return;
      events = saved;
      refresh();
      show('保存済みの台帳を開きました。');
    } catch (error) {
      show('台帳を開けませんでした。' + error.message, true);
    } finally {
      input.value = '';
    }
  });

  const guidance = $('csv-types');
  for (const [type, definition] of Object.entries(workflow.interfaces)) {
    if (definition.internal) continue;
    const item = element('li', (definition.from === department ? '書き出し' : '取り込み') + ' · ' +
      definition.name + '（' + type + '）');
    guidance.append(item);
  }
  refresh();
})();