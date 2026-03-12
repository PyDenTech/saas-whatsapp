import { pool } from '../config/db.js';
import {
  addMessage,
  assignConversation,
  closeConversation,
  moveToQueue,
  setConversationMetadata
} from './conversationService.js';
import { sendWhatsAppText } from './metaWhatsAppService.js';

const DEFAULT_FLOW = {
  welcome:
    'Olá! Sou o assistente virtual do atendimento de transporte escolar. Posso ajudar com informações gerais, horários, rotas e encaminhamento para um atendente humano.',
  menu:
    'Digite uma opção:\n1 - Rotas e horários\n2 - Documentos e cadastro\n3 - Protocolo do atendimento\n4 - Falar com um atendente\n5 - Encerrar atendimento',
  afterHours:
    'No momento estamos fora do horário principal de atendimento. Posso registrar sua solicitação e encaminhar para a equipe humana.',
  options: {
    '1': 'Para consultar rotas e horários, envie o nome do aluno, escola, localidade e turno. Se preferir, digite 4 para falar com um atendente.',
    '2': 'Para assuntos de cadastro, matrícula, atualização de endereço ou documentação, descreva o caso com o máximo de detalhes. Se quiser atendimento humano, digite 4.',
    '3': 'Seu protocolo é {{protocol}}. Guarde esse número para acompanhamento.',
    '4': 'Vou encaminhar seu atendimento para nossa equipe humana agora.',
    '5': 'Seu atendimento foi encerrado. Quando precisar, basta enviar uma nova mensagem por aqui.'
  },
  keywords: [
    {
      intents: ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'menu', 'iniciar', 'começar', 'comecar'],
      reply: 'Olá! Estou pronto para ajudar.'
    },
    {
      intents: ['rota', 'rotas', 'horário', 'horarios', 'horário do ônibus', 'ônibus', 'onibus', 'linha', 'transporte'],
      reply: 'Posso ajudar com informações de rota e horário. Envie nome do aluno, escola, localidade e turno, ou digite 4 para atendimento humano.'
    },
    {
      intents: ['cadastro', 'matrícula', 'matricula', 'documento', 'documentos', 'vaga', 'turma'],
      reply: 'Entendi. Para análise do cadastro, envie os dados do aluno e da solicitação. Se preferir, digite 4 para falar com um atendente.'
    }
  ],
  fallback:
    'Entendi sua mensagem. Posso orientar por aqui ou encaminhar para um atendente. Digite 1, 2, 3, 4 ou 5.',
  transferConfirmation:
    'Seu atendimento foi encaminhado para {{agent_name}}. Em instantes você receberá retorno da equipe.',
  queueConfirmation:
    'Seu atendimento entrou na fila humana. Assim que um atendente estiver disponível, continuará por aqui.',
  closeConfirmation:
    'Atendimento encerrado com sucesso. Obrigado pelo contato.'
};

function interpolate(text, variables = {}) {
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return variables[key] ?? '';
  });
}

function sanitizeFlow(flow) {
  if (!flow || typeof flow !== 'object' || Array.isArray(flow)) return DEFAULT_FLOW;
  return {
    ...DEFAULT_FLOW,
    ...flow,
    options: {
      ...DEFAULT_FLOW.options,
      ...(flow.options && typeof flow.options === 'object' ? flow.options : {})
    },
    keywords: Array.isArray(flow.keywords) ? flow.keywords : DEFAULT_FLOW.keywords
  };
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isHumanRequest(normalizedBody) {
  return ['4', 'atendente', 'humano', 'pessoa', 'suporte', 'transferir', 'falar com atendente', 'falar com humano']
    .some((term) => normalizedBody.includes(term));
}

function isCloseRequest(normalizedBody) {
  return ['5', 'encerrar', 'finalizar', 'sair', 'fechar atendimento'].some((term) => normalizedBody === term || normalizedBody.includes(term));
}

function detectMenuOption(normalizedBody) {
  const direct = normalizedBody.match(/^(1|2|3|4|5)$/)?.[1];
  if (direct) return direct;
  return null;
}

function detectKeywordReply(flow, normalizedBody) {
  for (const item of flow.keywords) {
    const intents = Array.isArray(item?.intents) ? item.intents : [];
    if (intents.some((intent) => normalizedBody.includes(normalizeText(intent)))) {
      return item.reply;
    }
  }
  return null;
}

async function getTenantContext(tenantId) {
  const { rows } = await pool.query(
    `select t.id, t.company_name, t.welcome_message, t.bot_flow_json,
            ts.auto_assign_enabled, ts.max_open_conversations_per_agent
     from tenants t
     left join tenant_settings ts on ts.tenant_id = t.id
     where t.id = $1`,
    [tenantId]
  );
  return rows[0] || null;
}

export async function findLeastBusyAgent(tenantId) {
  const { rows } = await pool.query(
    `select u.id, u.full_name,
            count(c.id) filter (where c.status = 'assigned') as active_conversations
     from users u
     left join conversations c
       on c.assigned_agent_id = u.id
      and c.tenant_id = u.tenant_id
      and c.status = 'assigned'
     where u.tenant_id = $1
       and u.is_active = true
       and u.role in ('admin', 'agent')
     group by u.id, u.full_name
     order by active_conversations asc, u.full_name asc`,
    [tenantId]
  );

  return rows[0] || null;
}

export async function autoAssignConversation({ tenantId, conversationId, reqMeta = {} }) {
  const tenant = await getTenantContext(tenantId);
  if (!tenant?.auto_assign_enabled) return null;

  const agent = await findLeastBusyAgent(tenantId);
  if (!agent) return null;

  const maxAllowed = Number(tenant.max_open_conversations_per_agent || 25);
  if (Number(agent.active_conversations || 0) >= maxAllowed) return null;

  await assignConversation({
    tenantId,
    conversationId,
    toUserId: agent.id,
    fromUserId: null,
    reqMeta
  });

  return agent;
}

async function recordOutboundBotMessage({ tenantId, conversationId, body, reqMeta = {} }) {
  await addMessage({
    tenantId,
    conversationId,
    senderType: 'bot',
    body,
    reqMeta
  });
}

export async function sendBotReply({ tenantId, conversationId, to, body, reqMeta = {} }) {
  await sendWhatsAppText({ tenantId, to, body });
  await recordOutboundBotMessage({ tenantId, conversationId, body, reqMeta });
}

export async function handleBotForInbound({ tenantId, conversationId, contactPhone, body, protocolCode, reqMeta = {} }) {
  const tenant = await getTenantContext(tenantId);
  if (!tenant) return { handled: false };

  const flow = sanitizeFlow(tenant.bot_flow_json);
  const normalizedBody = normalizeText(body);

  if (isCloseRequest(normalizedBody)) {
    const reply = interpolate(flow.closeConfirmation || flow.options['5'], { protocol: protocolCode });
    await sendBotReply({ tenantId, conversationId, to: contactPhone, body: reply, reqMeta });
    await closeConversation({ tenantId, conversationId, userId: null, reqMeta });
    await setConversationMetadata({ tenantId, conversationId, patch: { bot_last_option: '5' } });
    return { handled: true, action: 'close_requested' };
  }

  if (isHumanRequest(normalizedBody)) {
    await moveToQueue({ tenantId, conversationId, priority: 'high', reqMeta });
    const agent = await autoAssignConversation({ tenantId, conversationId, reqMeta });
    const reply = agent
      ? interpolate(flow.transferConfirmation, { agent_name: agent.full_name, protocol: protocolCode })
      : interpolate(flow.queueConfirmation, { protocol: protocolCode });
    await sendBotReply({ tenantId, conversationId, to: contactPhone, body: reply, reqMeta });
    await setConversationMetadata({ tenantId, conversationId, patch: { bot_last_option: '4', bot_handoff_requested: true } });
    return { handled: true, action: agent ? 'assigned' : 'queued', assignedAgent: agent };
  }

  const menuOption = detectMenuOption(normalizedBody);
  if (menuOption) {
    if (menuOption === '4') {
      return handleBotForInbound({ tenantId, conversationId, contactPhone, body: 'atendente', protocolCode, reqMeta });
    }

    const optionReply = interpolate(flow.options[menuOption], { protocol: protocolCode });
    const joinedReply = menuOption === '5'
      ? optionReply
      : `${optionReply}\n\n${flow.menu}`;
    await sendBotReply({ tenantId, conversationId, to: contactPhone, body: joinedReply, reqMeta });
    await setConversationMetadata({ tenantId, conversationId, patch: { bot_last_option: menuOption } });
    return { handled: true, action: `option_${menuOption}` };
  }

  const keywordReply = detectKeywordReply(flow, normalizedBody);
  if (keywordReply) {
    const reply = `${interpolate(keywordReply, { protocol: protocolCode })}\n\n${flow.menu}`;
    await sendBotReply({ tenantId, conversationId, to: contactPhone, body: reply, reqMeta });
    return { handled: true, action: 'keyword' };
  }

  const shouldSendWelcome = ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite'].includes(normalizedBody)
    || normalizedBody.length <= 2;

  const fallbackText = shouldSendWelcome
    ? `${flow.welcome || tenant.welcome_message || DEFAULT_FLOW.welcome}\n\n${flow.menu}`
    : `${flow.fallback}\n\n${flow.menu}`;

  await sendBotReply({ tenantId, conversationId, to: contactPhone, body: fallbackText, reqMeta });
  return { handled: true, action: shouldSendWelcome ? 'welcome' : 'fallback' };
}
