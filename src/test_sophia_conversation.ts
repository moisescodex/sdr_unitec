import { generateSdrResponse, SdrResponse } from './ai/openai';
import { Lead } from './state/LeadState';

async function simulateSophiaConversation() {
  console.log('🧪 Iniciando Simulação de Conversa Local com a Assistente Sophia (UNISE/UNIPÓS)...\n');

  // Inicializa o lead mockado
  const lead: Lead = {
    phone: '5591988888888',
    channel_phone_id: 'default',
    name: null,
    email: null,
    stage: 'SITUATION',
    status: 'active',
    history: [],
    has_cnpj: null,
    current_plan: null,
    num_lives: null,
    preferred_hospitals: null,
    document_status: null
  };

  // Turnos da conversa a simular
  const userMessages = [
    'Oi, boa tarde!',
    'Carlos Souza',
    'carlos.souza@gmail.com',
    '2', // Disciplinas Isoladas
    'Sim, já tenho os documentos. Segue o RG.',
    'Aqui está o histórico escolar.',
    'E por último, a autorização da coordenação.'
  ];

  // Mocks de document status que o webhook geraria após processamento de imagem/PDF
  const simulatedDocAnalyses = [
    null, // Oi
    null, // Carlos Souza
    null, // carlos.souza@gmail.com
    null, // Option 2 selected
    { rg_cnh: { type: 'rg', valid: true, feedback: 'RG legível e válido' } }, // RG sent
    { rg_cnh: { type: 'rg', valid: true, feedback: 'RG legível e válido' }, historico: { type: 'historico_escolar', valid: true, feedback: 'Histórico nítido' } }, // Histórico sent
    { rg_cnh: { type: 'rg', valid: true, feedback: 'RG legível e válido' }, historico: { type: 'historico_escolar', valid: true, feedback: 'Histórico nítido' }, parecer: { type: 'parecer_coordenacao', valid: true, feedback: 'Parecer aceito' } } // Parecer sent
  ];

  for (let i = 0; i < userMessages.length; i++) {
    const userMsg = userMessages[i];
    console.log(`👤 USUÁRIO: "${userMsg}"`);

    // Injeta o status de documento simulado se houver
    const docStatusMock = simulatedDocAnalyses[i];
    if (docStatusMock) {
      lead.document_status = JSON.stringify(docStatusMock);
      const docMsg = i === 4 ? '[Imagem enviada - Tipo: rg, Legível: true, É Documento: true, Feedback: RG legível e válido]' :
                    i === 5 ? '[Documento PDF enviado - Tipo: historico_escolar, Legível: true, É Documento: true, Feedback: Histórico nítido]' :
                    '[Documento PDF enviado - Tipo: parecer_coordenacao, Legível: true, É Documento: true, Feedback: Parecer aceito]';
      lead.history.push({ role: 'user', content: docMsg });
      console.log(`📎 (Sistema) Envia marcador: ${docMsg}`);
    } else {
      lead.history.push({ role: 'user', content: userMsg });
    }

    // Gera a resposta da Sophia (usa fallback se GEMINI_API_KEY não estiver no .env)
    const result: SdrResponse = await generateSdrResponse(lead);
    
    // Atualiza o lead com o resultado gerado
    lead.stage = result.stage;
    lead.history.push({ role: 'assistant', content: result.response, media: result.media });
    
    if (result.has_cnpj !== undefined) lead.has_cnpj = result.has_cnpj;
    if (result.current_plan !== undefined) lead.current_plan = result.current_plan;
    if (result.num_lives !== undefined) lead.num_lives = result.num_lives;
    if (result.preferred_hospitals !== undefined) lead.preferred_hospitals = result.preferred_hospitals;
    if (result.email !== undefined) lead.email = result.email;

    console.log(`🤖 SOPHIA (Estágio: ${lead.stage}):`);
    console.log(result.response.replace(/\\n/g, '\n'));
    if (result.media) {
      console.log(`📎 Mídia sugerida: [${result.media.type}] URL: ${result.media.url}`);
    }

    console.log('\n[CRM UPDATE]:', {
      name: lead.name,
      email: lead.email,
      current_plan_email: lead.current_plan,
      intern_extern: lead.has_cnpj,
      age_or_birth: lead.num_lives,
      course_interest: lead.preferred_hospitals,
      document_status: lead.document_status
    });
    console.log('--------------------------------------------------\n');
    
    // Pequena pausa para simular digitação
    await new Promise(resolve => setTimeout(resolve, 800));
  }

  console.log('🎉 Simulação da conversa da Sophia concluída com sucesso!');
}

simulateSophiaConversation();
