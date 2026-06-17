import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { env } from '../config/env';
import { Lead } from '../state/LeadState';

// Esquema de Resposta para Análise de Documentos
const DOCUMENT_ANALYSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    detectedType: {
      type: SchemaType.STRING,
      enum: ['rg', 'cnh', 'historico_escolar', 'parecer_coordenacao', 'outro'],
      description: 'O tipo do documento detectado: rg, cnh, historico_escolar, parecer_coordenacao ou outro.'
    },
    isReadable: {
      type: SchemaType.BOOLEAN,
      description: 'Indica se o texto do documento está nítido e legível.'
    },
    isDocument: {
      type: SchemaType.BOOLEAN,
      description: 'Indica se a imagem/PDF realmente corresponde a um documento válido do tipo detectado.'
    },
    feedback: {
      type: SchemaType.STRING,
      description: 'Feedback amigável em português explicando o resultado da análise ou pedindo correções de forma sutil.'
    }
  },
  required: ['detectedType', 'isReadable', 'isDocument', 'feedback']
};

// Inicializa o cliente do Gemini se a chave de API estiver disponível
const genAI = env.GEMINI_API_KEY ? new GoogleGenerativeAI(env.GEMINI_API_KEY) : null;

// Função auxiliar para executar chamadas da API do Gemini com tentativas em caso de erro 429 (Rate Limit / Quota)
async function callGeminiWithRetry(
  model: any,
  generateArgs: any,
  maxRetries: number = 3,
  delayMs: number = 2000
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await model.generateContent(generateArgs);
    } catch (error: any) {
      const errorStr = String(error?.message || error || '');
      const isRateLimit = errorStr.includes('429') || 
                          errorStr.toLowerCase().includes('quota') || 
                          errorStr.toLowerCase().includes('too many requests') ||
                          error?.status === 429;
      
      if (isRateLimit && attempt < maxRetries) {
        const waitTime = delayMs * Math.pow(2, attempt - 1);
        console.warn(`⚠️ [Gemini API] Limite de cota atingido (429/Quota). Tentativa ${attempt}/${maxRetries}. Aguardando ${waitTime}ms antes de tentar novamente...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
}

export const systemPrompt = `Você é a Sophia, assistente virtual oficial da UNIPÓS/DI UNISE, operando em parceria com a L A Educação.
Seu objetivo é acolher os usuários, coletar dados essenciais para o CRM (Nome e E-mail), responder a dúvidas sobre os cursos e Disciplinas Isoladas usando estritamente a Base de Conhecimento e direcionar para o atendimento humano (transbordo) quando necessário.

Tom de Voz e Diretrizes de Formatação (Foco em WhatsApp):
- Tom: Extremamente cordial, gentil, prestativa, clara e objetiva.
- Nunca envie blocos de texto gigantes. Use quebras de linha frequentes (\\n\\n) para separar parágrafos de forma amigável.
- Use negrito (*texto*) para destacar termos importantes, nomes de cursos, links e valores.
- Use emojis de forma moderada para manter o dinamismo sem perder o profissionalismo.
- REGRA DE OURO: Seja concisa, direta e insira perguntas de fechamento no final de cada mensagem. Nunca invente dados.
- NUNCA use aspas extras ou introduções fora do formato JSON exigido.

Fluxo Conversacional e Regras de Negócio (Passos de Atendimento):

Passo 1: Boas-vindas e Captura de Nome (Estágio 'SITUATION')
- Quando o usuário iniciar contato, envie:
  "Olá! Que bom te ver por aqui! Sou a Sophia, sua assistente virtual. Para começarmos, poderia me dizer seu nome completo, por favor? 😊"
- Mantenha o estágio em 'SITUATION'.

Passo 2: Coleta de E-mail (Estágio 'SITUATION')
- Quando o usuário responder com o nome, valide-o de forma simpática e solicite o e-mail:
  "Muito obrigada, [Nome]! Agora, para que eu possa te ajudar da melhor forma, qual é o seu e-mail favorito? Assim consigo manter você atualizado(a) com tudo que é relevante. 📧"
- Mantenha o estágio em 'SITUATION' até que o e-mail seja capturado.

Passo 3: Identificação do Assunto / Menu Principal (Estágio 'NEED_PAYOFF')
- Após coletar o e-mail, envie o menu de assuntos:
  "Perfeito! E para qual assunto você gostaria de atendimento hoje? Escolha uma das opções abaixo:
  
  1️⃣ Vestibulares e Matrícula
  2️⃣ Disciplinas Isoladas
  3️⃣ Secretaria Acadêmica
  4️⃣ Financeiro
  5️⃣ Tutoria
  6️⃣ Ouvidoria
  
  Digite o número correspondente à sua opção! 👇"
- Transicione o estágio para 'NEED_PAYOFF'.

Passo 4: Direcionamento / Transbordo para Fila Humana ou Resolução de Dúvidas
- Se o usuário escolher as opções 1, 3, 4, 5, 6 ou pedir para falar com um atendente diretamente:
  - Envie a mensagem de encaminhamento correspondente e adicione obrigatoriamente no final da resposta de texto a string de transbordo e aplicação de tag exatamente neste formato:
    Transferindo para o #{"queueId": "456"} setor Atendimento Humano e aplicar a tag #{"tagId":"160"}
  - Transicione o estágio para 'CONVERTED'.
- Mensagens de encaminhamento por opção:
  * Vestibulares e Matrícula (Opção 1): "Entendido! Você será direcionado(a) para a fila de Vestibulares e Matrícula. Lá, nossos atendentes estão prontos para te ajudar com informações sobre cursos, processo seletivo, provas, matrículas e acesso ao portal do aluno. Aguarde um instante, por favor. ⏳"
  * Secretaria Acadêmica (Opção 3): "Certo! Você será direcionado(a) para a Secretaria Acadêmica para tratar de situação de curso, emissão de diplomas, certificados e certidões. Em breve você será atendido(a). ✨"
  * Financeiro (Opção 4): "Ok! Te encaminhando para a fila Financeiro. Lá, você poderá resolver questões sobre boletos, pagamentos, acordos e promoções. Por favor, aguarde só um momento. 💳"
  * Tutoria (Opção 5): "Compreendido! Você será direcionado(a) para a fila de Tutoria para liberação/acompanhamento de cursos e suporte geral. Fique tranquilo(a), logo você será atendido(a). 📚"
  * Ouvidoria (Opção 6): "Anotei! Você será encaminhado(a) para a Ouvidoria para registrar sugestões, reclamações ou elogios. Sua opinião é muito importante para nós! 🎙️"
  * Humano geral sem fila: "Compreendo! Para que eu possa te direcionar para a pessoa certa, você poderia me dizer qual é o assunto do seu interesse? (Matrícula, Financeiro, Secretaria, Tutoria ou Ouvidoria?)"

Se o usuário escolher "2️⃣ Disciplinas Isoladas" ou fizer perguntas sobre Pós-Graduação/MBA, inicie o fluxo consultivo de dúvidas (Estágio 'MEETING_SCHEDULED'):
- Forneça informações claras e amigáveis baseadas na Base de Conhecimento abaixo.
- Sempre faça perguntas sobre os requisitos ou interesse dele (ex: qual curso/disciplina ele quer, se é aluno da UNISE ou de fora).
- Se ele estiver pronto para comprar Disciplinas Isoladas, solicite o envio dos documentos em PDF ou foto pelo WhatsApp:
  * RG ou CNH (frente e verso)
  * Histórico Escolar da Faculdade (atualizado)
  * Parecer da Coordenação de Curso
- O sistema valida automaticamente os arquivos recebidos e insere no histórico mensagens como:
  [Imagem enviada - Tipo: ..., Legível: ..., É Documento: ..., Feedback: ...]
- Leia estas mensagens do histórico para dar feedback:
  - Se algum documento falhar (Legível: false ou É Documento: false), peça a re-submissão de forma simpática com o feedback fornecido.
  - Se faltar algum (ex: Histórico ou Parecer), lembre-o de forma gentil do documento faltante.
  - Somente após todos os 3 documentos estarem válidos (RG/CNH, Histórico e Parecer ou termo de compromisso assinado), transicione para 'CONVERTED' e explique os próximos passos: a equipe comercial entrará em contato para finalizar a negociação e liberação. Adicione a string de transbordo no final!

Tratamento de Fallback e Encerramento (Estágio 'LOST'):
- Se o usuário expressar desinteresse (ex: "não quero mais", "deixa pra lá"), mude o estágio para 'LOST' e responda com extrema cordialidade, deixando o canal aberto.
- Se o usuário digitar algo não compreendido por 2 vezes seguidas, dispare: "Desculpe, não consegui entender bem. 😅 Vou te passar para um de nossos consultores agora mesmo para te ajudar!" e adicione o comando de transbordo e tag no formato exato: Transferindo para o #{"queueId": "456"} setor Atendimento Humano e aplicar a tag #{"tagId":"160"} transicionando o estágio para 'CONVERTED'.

=== BASE DE CONHECIMENTO ===

1. SOBRE A UNISE (Geral):
- Faculdade UNISE possui Nota Máxima no Credenciamento EAD do MEC. 91% de empregabilidade.
- Ofertas: Graduação e Pós-Graduação (EAD e Presencial), Disciplinas Isoladas e Cursos Livres.
- Cursos Presenciais: Administração, Direito, Enfermagem, Engenharia Civil, Farmácia, Fisioterapia, Medicina Veterinária, Pedagogia e Psicologia.
- Cursos EAD: Administração, Letras/Português, Processos Gerenciais, Pedagogia.
- Vestibular/Ingresso: https://www.unise.edu.br/

2. PÓS-GRADUAÇÃO & MBA (Lato Sensu):
- Áreas: Gestão Pública/Social/Segurança, Gestão/Liderança/RH, Finanças/Auditoria/Compliance, Marketing/Comunicação/Vendas, Tecnologia/Projetos/Logística, Engenharia/Obras/ESG, Direito, Educação/Humanidades.
- Duração: 4 a 12 meses (o aluno define o ritmo).
- Metodologia: 100% online (Plataforma AVA). Tutoria ativa inclusa.
- Investimento:
  * À vista (PIX ou Boleto): R$ 899,00
  * Parcelado: R$ 1.169,90 (até 10x sem juros no cartão)
  * Matrícula ISENTA em ambas as opções.
- Política de Combos: Descontos especiais para 2 ou mais cursos (transborde para o comercial para obter proposta personalizada).

3. DISCIPLINAS ISOLADAS:
- Compra: Exclusiva via central comercial WhatsApp: (86) 99991-0538 (menu Disciplinas Isoladas).
- Etapas:
  a) Solicita interesse.
  b) Informa as disciplinas desejadas (a UNISE envia os planos de ensino).
  c) Submete planos de ensino à coordenação da faculdade de origem para autorização.
  d) Com o parecer de aprovação da coordenação, efetua a compra.
  e) Preenche o Formulário de Inscrição.
  f) Efetua o pagamento e recebe o acesso ao AVA.
- Documentos obrigatórios (enviados em PDF/foto no ato da solicitação do certificado de conclusão): RG/CNH, Histórico Escolar atualizado e Parecer da Coordenação.
- Parecer da Coordenação: Simples autorização (pode ser print do WhatsApp ou e-mail do coordenador). Modelo sugerido de texto: "Eu, [Coordenador], do Curso [Curso], aprovo os planos de ensino e autorizo o aluno [Aluno] a cursar a(s) disciplina(s) avaliadas na UNISE."
- Termo de Compromisso Excepcional: Se o aluno não conseguir o parecer por burocracia, ele assume o risco de não conseguir o aproveitamento na faculdade de origem, devendo assinar digitalmente a declaração de ciência.
- Metodologia: Carga horária de 80 horas por disciplina. 100% online. Prazo de conclusão de até 30 dias. 4 unidades no AVA com trilhas, e-books, vídeos e game educativo na unidade IV.
- Avaliação: Mínimo 70% de acerto nas trilhas e unidades. Nota final mínima 7.0 e progresso >= 75%.
- Recuperação: Se reprovado, taxa de R$ 150,00 para realizar avaliação de recuperação (10 questões).
- Tabela de Preços (Disciplinas Isoladas):
  * Padrão (80h - Direito, Engenharias, Gestão, TI, Saúde): R$ 720,00 (6x cartão) ou R$ 540,00 à vista (PIX).
  * Específicas Saúde (120h): R$ 849,90.
  * Específicas Saúde (160h): R$ 1.049,90.
  * Educação (80h): R$ 549,90 (3x cartão) ou R$ 420,00 à vista (PIX).
- **PROMOÇÃO HISTÓRICA VIGENTE (Até 30/06/2026)**:
  * Educação e Interdisciplinares: R$ 350,00 (PIX) ou R$ 459,00 (cartão em até 6x).
  * Direito, Saúde, Gestão, Engenharia e TI: R$ 450,00 (PIX) ou R$ 599,00 (cartão em até 6x).
- Programa Bônus Amigos: R$ 50,00 de crédito para quem indica (após aprovação da compra do indicado), R$ 30,00 de desconto para o amigo indicado na primeira compra.

Responda APENAS com um objeto JSON válido seguindo o esquema estruturado abaixo. Não inclua Markdown (\`\`\`json) no início ou fim.
As quebras de linha na resposta de texto devem usar \\n escapado no JSON.`;

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    stage: { 
      type: SchemaType.STRING, 
      description: "O estágio atual do funil: 'SITUATION', 'NEED_PAYOFF', 'MEETING_SCHEDULED', 'CONVERTED' ou 'LOST'" 
    },
    response: { 
      type: SchemaType.STRING, 
      description: "O texto da mensagem a ser enviada ao lead no WhatsApp" 
    },
    has_cnpj: { 
      type: SchemaType.STRING, 
      description: "Indica se o aluno é interno ou externo: 'interno', 'externo' ou null se não souber" 
    },
    current_plan: { 
      type: SchemaType.STRING, 
      description: "O e-mail coletado do aluno (ex: 'aluno@gmail.com'), ou null se não souber" 
    },
    num_lives: { 
      type: SchemaType.STRING, 
      description: "A idade ou data de nascimento do aluno se fornecida, ou null se não souber" 
    },
    preferred_hospitals: { 
      type: SchemaType.STRING, 
      description: "O curso ou disciplina de interesse (ex: 'Direito Civil'), ou null se não souber" 
    },
    email: {
      type: SchemaType.STRING,
      description: "O e-mail coletado do aluno, ou null se não souber"
    },
    media: {
      type: SchemaType.OBJECT,
      properties: {
        type: { type: SchemaType.STRING, description: "O tipo de mídia: 'image', 'document', 'audio' ou 'video'" },
        url: { type: SchemaType.STRING, description: "A URL do arquivo de mídia no catálogo para envio" },
        filename: { type: SchemaType.STRING, description: "Nome do arquivo (ex: 'Edital.pdf')" }
      }
    }
  },
  required: ["stage", "response"]
};

export interface SdrResponse {
  stage: Lead['stage'];
  response: string;
  has_cnpj?: string | null;
  current_plan?: string | null;
  num_lives?: string | null;
  preferred_hospitals?: string | null;
  email?: string | null;
  media?: {
    type: 'image' | 'document' | 'audio' | 'video';
    url: string;
    filename?: string;
  } | null;
}

export async function generateSdrResponse(lead: Lead, baseUrl: string = 'https://sdr-perelli.onrender.com'): Promise<SdrResponse> {
  if (!genAI) {
    return getFallbackMockResponse(lead, baseUrl);
  }

  try {
    const trimmedHistory = lead.history.slice(-12);
    
    // Converte o histórico para o formato do Gemini SDK
    const contents = trimmedHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content || '' }]
    }));

    // Injeta informações e estado do banco de dados no prompt para melhor contextualização
    const databaseContext = `
[DADOS ATUAIS NO BANCO DE DADOS]
- Telefone: ${lead.phone}
- Nome: ${lead.name || 'Não fornecido'}
- E-mail: ${lead.email || 'Não fornecido'}
- Estágio Atual: ${lead.stage}
- Aluno Interno/Externo: ${lead.has_cnpj || 'Não identificado'}
- E-mail Mapeado: ${lead.current_plan || 'Não identificado'}
- Idade/Nascimento: ${lead.num_lives || 'Não identificado'}
- Curso/Disciplina de Interesse: ${lead.preferred_hospitals || 'Não identificado'}
- ID do Canal: ${lead.channel_phone_id || 'default'}
`;

    const resolvedSystemPrompt = systemPrompt.replace(/{{BASE_URL}}/g, baseUrl);

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: resolvedSystemPrompt + databaseContext,
      generationConfig: {
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA
      } as any
    });

    const result = await callGeminiWithRetry(model, { contents });
    const content = result.response.text().trim();
    
    let jsonString = content;
    if (jsonString.startsWith('```')) {
      jsonString = jsonString.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(jsonString) as SdrResponse;
    
    // Sanitiza e atualiza o lead caso novos dados tenham sido mapeados no JSON
    if (parsed.has_cnpj !== undefined) lead.has_cnpj = parsed.has_cnpj;
    if (parsed.current_plan !== undefined) lead.current_plan = parsed.current_plan;
    if (parsed.num_lives !== undefined) lead.num_lives = parsed.num_lives;
    if (parsed.preferred_hospitals !== undefined) lead.preferred_hospitals = parsed.preferred_hospitals;
    if (parsed.email !== undefined) lead.email = parsed.email;

    return parsed;
  } catch (error) {
    console.error('❌ Erro ao gerar resposta do SDR (Gemini):', error);
    return getFallbackMockResponse(lead);
  }
}

export async function generateFollowUpCadence(lead: Lead, stageIndex: number): Promise<string> {
  if (!genAI) {
    return 'Opa, conseguimos continuar por aqui? Se preferir, podemos tirar suas dúvidas direto pelo Whats mesmo. O que acha?';
  }

  try {
    const trimmedHistory = lead.history.slice(-10);
    const contents = [
      ...trimmedHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model' as 'user' | 'model',
        parts: [{ text: msg.content || '' }]
      })),
      {
        role: 'user' as const,
        parts: [{ text: `Instrução do Sistema: O lead está sem responder. Este é o follow-up de nível ${stageIndex} que estamos enviando.
Seu objetivo é, de forma muito informal, natural e amigável (tom de WhatsApp no Brasil, usando gírias leves como "vc", "tá", "blz", "gnt"):
1. Perguntar se ele quer continuar com a cotação do plano de saúde/seguro ou se o dia está muito corrido.
2. Relembrar que são os últimos dias para aproveitar os benefícios: Redução nas carências, 50% de desconto na 2ª e na 13ª mensalidade, e Sem Taxa de Adesão.
3. Oferecer responder direto por texto aqui no WhatsApp para não tomar tempo.
4. Tentar obter uma resposta se quer continuar ou não, sem ser chato.

Regras rígidas:
- Limite de 25 palavras.
- Retorne APENAS o texto do follow-up, sem aspas extras, sem explicações.` }]
      }
    ];

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.8,
      }
    });

    const result = await callGeminiWithRetry(model, { contents });
    return result.response.text().trim();
  } catch (error) {
    console.error(`❌ Erro ao gerar follow-up (etapa ${stageIndex}) com Gemini:`, error);
    return 'Tudo bem por aí? Se a rotina tiver corrida, me avisa se prefere receber a cotação direto por texto aqui.';
  }
}

export async function generateFollowUp(lead: Lead): Promise<string> {
  return `E aí, blz? Quer seguir c/ a cotação ou tá corrido? Últimos dias para:
✅ Redução nas carências 
✅ 50% de desconto na 2ª e na 13ª mensalidade.*
✅ Sem Taxa de Adesão(Não paga nada agora para contratar)

Me diz, blz?`;
}

export async function generateThreeHourFollowUp(lead: Lead): Promise<string> {
  return generateFollowUpCadence(lead, 1);
}

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<string> {
  if (!genAI) {
    return '[Áudio recebido, mas o motor de IA local está sem chaves. Mock de transcrição: Olá, quero um plano de saúde]';
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const audioPart = {
      inlineData: {
        data: audioBuffer.toString('base64'),
        mimeType: mimeType
      }
    };
    const prompt = 'Transcreva este áudio do WhatsApp em português brasileiro de forma exata, sem adicionar nenhum comentário, introdução ou explicação. Apenas o texto falado.';
    const result = await callGeminiWithRetry(model, [prompt, audioPart]);
    return result.response.text().trim();
  } catch (error) {
    console.error('❌ Erro ao transcrever áudio com Gemini:', error);
    throw error;
  }
}

export async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  if (!genAI) {
    return '[PDF recebido. Resumo mock: Arquivo contém dados pessoais do lead e cotação anterior]';
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const pdfPart = {
      inlineData: {
        data: pdfBuffer.toString('base64'),
        mimeType: 'application/pdf'
      }
    };
    const prompt = 'Leia este documento PDF e extraia as informações mais importantes e o texto principal em formato resumido, para que o SDR saiba do que se trata. Retorne apenas o resumo em português de forma clara.';
    const result = await callGeminiWithRetry(model, [prompt, pdfPart]);
    return result.response.text().trim();
  } catch (error) {
    console.error('❌ Erro ao extrair texto do PDF com Gemini:', error);
    throw error;
  }
}

export interface DocumentAnalysisResult {
  detectedType: 'rg' | 'cnh' | 'comprovante_residencia' | 'outro';
  isReadable: boolean;
  isDocument: boolean;
  feedback: string;
}

export async function analyzeDocument(buffer: Buffer, mimeType: string): Promise<DocumentAnalysisResult> {
  if (!genAI) {
    const isPdf = mimeType === 'application/pdf';
    return {
      detectedType: isPdf ? 'historico_escolar' : 'rg',
      isReadable: true,
      isDocument: true,
      feedback: 'Documento analisado com sucesso (modo de simulação/mock).'
    };
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: DOCUMENT_ANALYSIS_SCHEMA
      } as any
    });

    const filePart = {
      inlineData: {
        data: buffer.toString('base64'),
        mimeType: mimeType
      }
    };

    const prompt = `Analise atentamente o documento fornecido (imagem ou PDF). Seu objetivo é identificar se este arquivo corresponde a:
1. Um documento de identificação oficial com foto (como RG ou CNH).
2. Um Histórico Escolar (documento com grade curricular, notas, matérias e dados acadêmicos).
3. Um Parecer da Coordenação (autorização, print de conversa, e-mail do coordenador autorizando cursar matérias ou termo de compromisso assinado).

Avalie se:
1. O documento é legível (se a foto não está tremida, desfocada, com reflexos ou dedos cobrindo dados importantes).
2. O documento é de fato um RG, CNH, Histórico Escolar ou Parecer da Coordenação.

Retorne uma resposta estritamente estruturada em JSON contendo os campos:
- detectedType: "rg" | "cnh" | "historico_escolar" | "parecer_coordenacao" | "outro"
- isReadable: boolean
- isDocument: boolean
- feedback: string (com uma explicação clara e amigável em português do resultado. Ex: "RG legível e válido", "Histórico escolar nítido e válido", "Parecer de coordenação legível")`;

    const result = await callGeminiWithRetry(model, [prompt, filePart]);
    const responseText = result.response.text().trim();
    
    let jsonString = responseText;
    if (jsonString.startsWith('```')) {
      jsonString = jsonString.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }

    return JSON.parse(jsonString) as DocumentAnalysisResult;
  } catch (error) {
    console.error('❌ Erro ao analisar documento com Gemini:', error);
    return {
      detectedType: 'outro',
      isReadable: false,
      isDocument: false,
      feedback: 'Não consegui ler o documento enviado. Poderia reenviar uma foto mais nítida?'
    };
  }
}

export function getRegionFromPhone(phone: string): { city: string, state: string, ddd: string } {
  const cleanPhone = phone.replace(/\D/g, '');
  let ddd = '';
  if (cleanPhone.startsWith('55') && cleanPhone.length >= 4) {
    ddd = cleanPhone.substring(2, 4);
  } else if (cleanPhone.length >= 2) {
    ddd = cleanPhone.substring(0, 2);
  }

  const dddMap: { [key: string]: { city: string, state: string } } = {
    // Pará
    '91': { city: 'Belém', state: 'PA' },
    '93': { city: 'Santarém', state: 'PA' },
    '94': { city: 'Marabá', state: 'PA' },
    // Rio de Janeiro
    '21': { city: 'Rio de Janeiro', state: 'RJ' },
    '22': { city: 'Campos dos Goytacazes', state: 'RJ' },
    '24': { city: 'Petrópolis', state: 'RJ' },
    // São Paulo
    '11': { city: 'São Paulo', state: 'SP' },
    '12': { city: 'São José dos Campos', state: 'SP' },
    '13': { city: 'Santos', state: 'SP' },
    '14': { city: 'Bauru', state: 'SP' },
    '15': { city: 'Sorocaba', state: 'SP' },
    '16': { city: 'Ribeirão Preto', state: 'SP' },
    '17': { city: 'São José do Rio Preto', state: 'SP' },
    '18': { city: 'Presidente Prudente', state: 'SP' },
    '19': { city: 'Campinas', state: 'SP' },
    // Minas Gerais
    '31': { city: 'Belo Horizonte', state: 'MG' },
    '32': { city: 'Juiz de Fora', state: 'MG' },
    '34': { city: 'Uberlândia', state: 'MG' },
    '35': { city: 'Poços de Caldas', state: 'MG' },
  };

  const mapped = dddMap[ddd];
  return mapped ? { ...mapped, ddd } : { city: 'São José do Rio Preto', state: 'SP', ddd };
}

function getFallbackMockResponse(lead: Lead, baseUrl: string = 'https://sdr-perelli.onrender.com'): SdrResponse {
  const lastUserMsg = lead.history.filter(m => m.role === 'user').pop()?.content?.toLowerCase() || '';
  const assistantMessages = lead.history.filter(m => m.role === 'assistant');
  const lastAssistantMsg = assistantMessages[assistantMessages.length - 1]?.content?.toLowerCase() || '';
  
  let stage = lead.stage;
  let response = '';
  let media: SdrResponse['media'] = null;

  let has_cnpj = lead.has_cnpj;
  let current_plan = lead.current_plan;
  let num_lives = lead.num_lives;
  let preferred_hospitals = lead.preferred_hospitals;
  let email = lead.email;

  const isNegative = lastUserMsg.includes('não quero') || lastUserMsg.includes('nao quero') || 
                     lastUserMsg.includes('não tenho interesse') || lastUserMsg.includes('nao tenho interesse') || 
                     lastUserMsg.includes('deixa pra') || lastUserMsg.includes('deixar pra') ||
                     lastUserMsg.includes('ainda não') || lastUserMsg.includes('ainda nao') || 
                     lastUserMsg.includes('cancelar') || lastUserMsg.includes('outro dia') || 
                     lastUserMsg.includes('depois');

  if (isNegative) {
    stage = 'LOST';
    const clientName = lead.name || 'Estudante';
    response = `Entendo perfeitamente, ${clientName}! Sem problemas. Se no futuro você quiser fazer um curso na UNISE ou tirar dúvidas sobre Disciplinas Isoladas, pode me mandar uma mensagem por aqui. Fico à disposição. Um ótimo dia para você!`;
    return {
      stage,
      response,
      has_cnpj,
      current_plan,
      num_lives,
      preferred_hospitals,
      email,
      media
    };
  }

  if (stage === 'LOST') {
    if (lastUserMsg.includes('quero') || lastUserMsg.includes('voltar') || lastUserMsg.includes('sim') || lastUserMsg.includes('mudei de ideia') || lastUserMsg.includes('cotar') || lastUserMsg.includes('oi')) {
      stage = 'SITUATION'; // Reset
    } else {
      const clientName = lead.name || 'Estudante';
      response = `Olá, ${clientName}! Se desejar voltar a falar com a UNISE, basta me mandar um "olá" por aqui.`;
      return {
        stage,
        response,
        has_cnpj,
        current_plan,
        num_lives,
        preferred_hospitals,
        email,
        media
      };
    }
  }

  const isGreeting = lastUserMsg === 'oi' || lastUserMsg === 'olá' || lastUserMsg === 'bom dia' || lastUserMsg === 'boa tarde' || lastUserMsg === 'ola';

  if (stage === 'SITUATION') {
    if (isGreeting || lastAssistantMsg === '') {
      response = `Olá! Que bom te ver por aqui! Sou a Sophia, sua assistente virtual. Para começarmos, poderia me dizer seu nome completo, por favor? 😊`;
    } else if (lastAssistantMsg.includes('nome completo')) {
      // O usuário informou o nome
      lead.name = lastUserMsg.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      response = `Muito obrigada, ${lead.name}! Agora, para que eu possa te ajudar da melhor forma, qual é o seu e-mail favorito? Assim consigo manter você atualizado(a) com tudo que é relevante. 📧`;
    } else if (lastAssistantMsg.includes('e-mail favorito')) {
      // O usuário informou o e-mail
      email = lastUserMsg.trim();
      current_plan = email; // Mapeia para current_plan para exibição no card do CRM
      stage = 'NEED_PAYOFF';
      response = `Perfeito! E para qual assunto você gostaria de atendimento hoje? Escolha uma das opções abaixo:\n\n1️⃣ Vestibulares e Matrícula\n2️⃣ Disciplinas Isoladas\n3️⃣ Secretaria Acadêmica\n4️⃣ Financeiro\n5️⃣ Tutoria\n6️⃣ Ouvidoria\n\nDigite o número correspondente à sua opção! 👇`;
    } else {
      response = `Olá! Que bom te ver por aqui! Sou a Sophia, sua assistente virtual. Para começarmos, poderia me dizer seu nome completo, por favor? 😊`;
    }
  } else if (stage === 'NEED_PAYOFF') {
    const option = lastUserMsg.trim();
    if (option === '1') {
      stage = 'CONVERTED';
      response = `Entendido! Você será direcionado(a) para a fila de Vestibulares e Matrícula. Lá, nossos atendentes estão prontos para te ajudar com informações sobre cursos, processo seletivo, provas, matrículas e acesso ao portal do aluno. Aguarde um instante, por favor. ⏳\n\nTransferindo para o #{"queueId": "456"} setor Atendimento Humano e aplicar a tag #{"tagId":"160"}`;
    } else if (option === '3') {
      stage = 'CONVERTED';
      response = `Certo! Você será direcionado(a) para a Secretaria Acadêmica para tratar de situação de curso, emissão de diplomas, certificados e certidões. Em breve você será atendido(a). ✨\n\nTransferindo para o #{"queueId": "456"} setor Atendimento Humano e aplicar a tag #{"tagId":"160"}`;
    } else if (option === '4') {
      stage = 'CONVERTED';
      response = `Ok! Te encaminhando para a fila Financeiro. Lá, você poderá resolver questões sobre boletos, pagamentos, acordos e promoções. Por favor, aguarde só um momento. 💳\n\nTransferindo para o #{"queueId": "456"} setor Atendimento Humano e aplicar a tag #{"tagId":"160"}`;
    } else if (option === '5') {
      stage = 'CONVERTED';
      response = `Compreendido! Você será direcionado(a) para a fila de Tutoria para liberação/acompanhamento de cursos e suporte geral. Fique tranquilo(a), logo você será atendido(a). 📚\n\nTransferindo para o #{"queueId": "456"} setor Atendimento Humano e aplicar a tag #{"tagId":"160"}`;
    } else if (option === '6') {
      stage = 'CONVERTED';
      response = `Anotei! Você será encaminhado(a) para a Ouvidoria para registrar sugestões, reclamações ou elogios. Sua opinião é muito importante para nós! 🎙️\n\nTransferindo para o #{"queueId": "456"} setor Atendimento Humano e aplicar a tag #{"tagId":"160"}`;
    } else if (option === '2') {
      stage = 'MEETING_SCHEDULED';
      preferred_hospitals = 'Disciplinas Isoladas'; // Mapeia para preferred_hospitals para exibição no card
      response = `Perfeito! Encaminhando você para a fila de Disciplinas Isoladas. Nossos especialistas vão te auxiliar com a oferta de disciplinas, requisitos, preços e inscrição.\n\nPara darmos início à contratação, preciso que envie por aqui os seguintes documentos:\n\n🧾 DOCUMENTOS NECESSÁRIOS:\n📸 FOTOS LEGÍVEIS OU PDF\n\n🪪 RG ou CNH (Frente e verso)\n🏫 Histórico Escolar da Faculdade (Atualizado)\n✍️ Parecer da Coordenação de Curso\n\nVocê já tem esses documentos em mãos para me enviar?`;
    } else {
      response = `Compreendo! Para que eu possa te direcionar para a pessoa certa, você poderia me dizer qual é o assunto do seu interesse? Digite o número correspondente:\n\n1️⃣ Vestibulares e Matrícula\n2️⃣ Disciplinas Isoladas\n3️⃣ Secretaria Acadêmica\n4️⃣ Financeiro\n5️⃣ Tutoria\n6️⃣ Ouvidoria`;
    }
  } else if (stage === 'MEETING_SCHEDULED') {
    // Parse doc status
    let hasRgCnh = false;
    let hasHistory = false;
    let hasOpinion = false;
    let feedback = '';

    if (lead.document_status) {
      try {
        const docStatus = JSON.parse(lead.document_status);
        hasRgCnh = docStatus.rg_cnh?.valid === true;
        hasHistory = docStatus.historico?.valid === true;
        hasOpinion = docStatus.parecer?.valid === true;
        if (docStatus.rg_cnh?.valid === false) feedback = docStatus.rg_cnh.feedback;
        else if (docStatus.historico?.valid === false) feedback = docStatus.historico.feedback;
        else if (docStatus.parecer?.valid === false) feedback = docStatus.parecer.feedback;
      } catch (_) {}
    }

    const isDocSent = lastUserMsg.includes('[documento') || lastUserMsg.includes('[imagem') || lastUserMsg.includes('segue') || lastUserMsg.includes('.pdf') || lastUserMsg.includes('.png');

    if (hasRgCnh && hasHistory && hasOpinion) {
      stage = 'CONVERTED';
      response = `Excelente! Recebi todos os seus documentos (Identidade, Histórico Escolar e Parecer de Coordenação) e estão todos válidos!\n\nAgora, a nossa equipe comercial vai entrar em contato para finalizar a sua matrícula e emitir as opções de pagamento. Aguarde só um instante! ⚡\n\nTransferindo para o #{"queueId": "456"} setor Atendimento Humano e aplicar a tag #{"tagId":"160"}`;
    } else if (feedback) {
      response = `Poxa, tivemos um probleminha na validação do documento: ${feedback}. Você conseguiria enviar novamente, por favor?`;
    } else if (hasRgCnh && hasHistory) {
      response = `Recebi seu documento de identificação e o histórico escolar! Agora só fica faltando o Parecer da Coordenação de Curso (ou o termo de compromisso excepcional) para podermos concluir.`;
    } else if (hasRgCnh && hasOpinion) {
      response = `Recebi seu documento de identificação e o parecer da coordenação! Agora só fica faltando o seu Histórico Escolar atualizado.`;
    } else if (hasHistory && hasOpinion) {
      response = `Recebi seu histórico escolar e o parecer da coordenação! Agora só fica faltando o seu documento de identificação (RG ou CNH).`;
    } else if (hasRgCnh) {
      response = `Que ótimo, recebi o seu documento de identificação! Agora só fica faltando enviar o Histórico Escolar atualizado e o Parecer da Coordenação.`;
    } else if (isDocSent) {
      // Simulação no fallback (aceita tudo como convertido)
      stage = 'CONVERTED';
      response = `Recebi os documentos! Agora, a nossa equipe comercial vai entrar em contato para finalizar a sua matrícula e emitir as opções de pagamento. Aguarde só um instante! ⚡\n\nTransferindo para o #{"queueId": "456"} setor Atendimento Humano e aplicar a tag #{"tagId":"160"}`;
    } else {
      response = `Para darmos andamento à inscrição de Disciplinas Isoladas, por favor envie fotos legíveis ou arquivos em PDF dos documentos (RG/CNH, Histórico Escolar e Parecer da Coordenação). Caso tenha dúvidas sobre carência ou valores, pode perguntar!`;
    }
  } else if (stage === 'CONVERTED') {
    response = `Olá! A sua solicitação já foi encaminhada para a nossa equipe. Um consultor humano entrará em contato em breve para dar andamento, combinado?\n\nTransferindo para o #{"queueId": "456"} setor Atendimento Humano e aplicar a tag #{"tagId":"160"}`;
  }

  return {
    stage,
    response,
    has_cnpj,
    current_plan,
    num_lives,
    preferred_hospitals,
    email,
    media
  };
}

export async function generateAnalyticsInsights(leadsData: string): Promise<any> {
  if (!genAI) {
    return {
      success_factors: ["Interação rápida do SDR com propostas personalizadas", "Envio ágil de comprovante de residência e RG/CNH"],
      dropoff_factors: ["Dúvidas não resolvidas sobre coparticipação", "Demora de resposta do lead após solicitar documentos"],
      main_objections: [
        { objection: "Dúvida sobre taxa de coparticipação", frequency: "Alta", handling_efficacy: "Boa" },
        { objection: "Exigência de CNH ou RG fora do plástico", frequency: "Média", handling_efficacy: "Média" }
      ],
      best_incentives: ["Proposta com cotação CNPJ/MEI mais barata", "Destaque da rede de hospitais credenciados"],
      actionable_recommendations: ["Adicionar um áudio explicativo sobre carências de doenças preexistentes", "Simplificar a solicitação inicial de documentos para o cliente"]
    };
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    });

    const prompt = `Você é o Diretor de Analytics e IA da Perelli Corretora de Seguros de Saúde.
Analise os seguintes históricos de conversas reais de leads que interagiram com o robô SDR automático (Perelli) e foram convertidos (CONVERTED) ou perdidos (LOST).

CONVERSAS DOS LEADS:
${leadsData}

Seu objetivo é identificar de forma crítica e contínua o comportamento das pessoas.
Identifique:
1. Fatores de Avanço (O que faz as pessoas avançarem na conversa?)
2. Fatores de Abandono (O que faz as pessoas pararem ou silenciarem?)
3. Principais Objeções e Dúvidas (quais são, com que frequência ocorrem e quão bem o robô lidou com elas)
4. Melhores Incentivos (gatilhos de urgência, rede credenciada, preços via MEI/CNPJ, etc.)
5. Recomendações Práticas (o que o time de marketing ou tecnologia deve ajustar nos prompts ou canais de venda)

Retorne obrigatoriamente um JSON estruturado com o seguinte formato:
{
  "success_factors": ["fator 1", "fator 2"],
  "dropoff_factors": ["fator 1", "fator 2"],
  "main_objections": [
    {
      "objection": "descrição curta da objeção",
      "frequency": "Alta" | "Média" | "Baixa",
      "handling_efficacy": "Boa" | "Média" | "Ruim"
    }
  ],
  "best_incentives": ["incentivo 1", "incentivo 2"],
  "actionable_recommendations": ["recomendação 1", "recomendação 2"]
}`;

    const result = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
    const content = result.response.text().trim();
    
    let jsonString = content;
    if (jsonString.startsWith('```')) {
      jsonString = jsonString.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }

    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Erro ao gerar insights de analytics com Gemini:', error);
    throw error;
  }
}
