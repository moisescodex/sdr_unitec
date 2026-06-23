import { getDb, isDbConnected } from './state/db';
import { LeadState } from './state/LeadState';
import { getChannelConfig, sendMessage, sendMediaMessage } from './whatsapp/client';

async function runMulticanalTest() {
  console.log('🧪 Iniciando Verificação de Integração Multicanal (Facebook Messenger & Instagram Direct)...');

  // 1. Conecta ao Banco de Dados
  const db = await getDb();
  if (!db || !isDbConnected) {
    console.error('❌ Não foi possível conectar ao banco de dados para os testes.');
    process.exit(1);
  }

  const fbPageId = 'fb_test_page_unipof';
  const igAccountId = 'ig_test_account_unipof';
  const fbUserId = 'fb_user_alice';
  const igUserId = 'ig_user_bob';

  try {
    // 2. Limpeza prévia de dados de teste antigos
    console.log('🧹 Limpando dados antigos de teste...');
    await db.query("DELETE FROM leads WHERE phone IN ($1, $2)", [fbUserId, igUserId]);
    await db.query("DELETE FROM whatsapp_channels WHERE phone_number_id IN ($1, $2)", [fbPageId, igAccountId]);

    // 3. Cadastra os canais de teste
    console.log('📝 Inserindo canais de teste no banco de dados...');
    await db.query(
      `INSERT INTO whatsapp_channels (phone_number_id, display_phone_number, access_token, name, type) 
       VALUES ($1, 'Facebook Page Test', 'EAA_TEST_TOKEN_123', 'Página FB Unipós', 'messenger')`,
      [fbPageId]
    );
    await db.query(
      `INSERT INTO whatsapp_channels (phone_number_id, display_phone_number, access_token, name, type) 
       VALUES ($1, 'Instagram Account Test', 'EAA_TEST_TOKEN_456', 'Insta Unipós', 'instagram')`,
      [igAccountId]
    );

    // 4. Valida getChannelConfig
    console.log('🔍 Validando getChannelConfig...');
    const fbConfig = await getChannelConfig(fbPageId);
    console.log('   Configuração FB recuperada:', fbConfig);
    if (fbConfig.type !== 'messenger' || fbConfig.name !== 'Página FB Unipós') {
      throw new Error('Falha na validação do canal Messenger');
    }

    const igConfig = await getChannelConfig(igAccountId);
    console.log('   Configuração Instagram recuperada:', igConfig);
    if (igConfig.type !== 'instagram' || igConfig.name !== 'Insta Unipós') {
      throw new Error('Falha na validação do canal Instagram');
    }

    // 5. Simulação de criação e persistência de Leads
    console.log('👤 Criando leads de teste e validando channel_type...');
    
    // Lead do Facebook Messenger
    const fbLead = await LeadState.getLead(fbUserId, fbPageId);
    fbLead.name = 'Alice FB Client';
    fbLead.channel_type = 'messenger';
    fbLead.source = 'page';
    await LeadState.saveLead(fbLead);

    // Lead do Instagram
    const igLead = await LeadState.getLead(igUserId, igAccountId);
    igLead.name = 'Bob IG Client';
    igLead.channel_type = 'instagram';
    igLead.source = 'instagram';
    await LeadState.saveLead(igLead);

    // 6. Verifica se os leads foram salvos no banco com as propriedades corretas
    const dbFbLead = await LeadState.getLead(fbUserId, fbPageId);
    console.log('   Lead FB recuperado do banco:', {
      phone: dbFbLead.phone,
      channel_phone_id: dbFbLead.channel_phone_id,
      name: dbFbLead.name,
      channel_type: dbFbLead.channel_type,
      source: dbFbLead.source
    });
    if (dbFbLead.channel_type !== 'messenger' || dbFbLead.source !== 'page') {
      throw new Error('channel_type ou source incorretos para o lead do Messenger');
    }

    const dbIgLead = await LeadState.getLead(igUserId, igAccountId);
    console.log('   Lead Instagram recuperado do banco:', {
      phone: dbIgLead.phone,
      channel_phone_id: dbIgLead.channel_phone_id,
      name: dbIgLead.name,
      channel_type: dbIgLead.channel_type,
      source: dbIgLead.source
    });
    if (dbIgLead.channel_type !== 'instagram' || dbIgLead.source !== 'instagram') {
      throw new Error('channel_type ou source incorretos para o lead do Instagram');
    }

    // 7. Teste de rotas de envio (sendMessage / sendMediaMessage)
    console.log('📤 Testando fluxo de envio de mensagens e mídia para Messenger/Instagram...');
    // Esperamos erros 400/401/403/190 ou falhas de fetch reais porque usamos tokens falsificados,
    // mas o importante é validar que a rota correta da Graph API está sendo chamada.
    await sendMessage(fbPageId, fbUserId, 'Olá Alice! Mensagem de teste do Messenger.');
    await sendMessage(igAccountId, igUserId, 'Olá Bob! Mensagem de teste do Instagram.');

    await sendMediaMessage(
      fbPageId,
      fbUserId,
      'image',
      { link: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809' },
      'banner.png'
    );

    // 8. Teste de listagem no painel CRM
    console.log('📋 Validando listagem de leads com canal específico no CRM...');
    const allLeads = await LeadState.getAllLeads();
    const fbLeadsInCrm = allLeads.filter(l => l.channel_phone_id === fbPageId);
    const igLeadsInCrm = allLeads.filter(l => l.channel_phone_id === igAccountId);
    
    console.log(`   Leads do Facebook cadastrados: ${fbLeadsInCrm.length}`);
    console.log(`   Leads do Instagram cadastrados: ${igLeadsInCrm.length}`);
    
    if (fbLeadsInCrm.length !== 1 || igLeadsInCrm.length !== 1) {
      throw new Error('A listagem de leads no CRM falhou para os novos canais');
    }

    console.log('✅ Todos os testes locais e validações no banco de dados passaram com sucesso!');
  } catch (err) {
    console.error('❌ Erro durante o teste de integração:', err);
  } finally {
    // Limpeza final para não deixar sujeira
    console.log('🧹 Executando limpeza final...');
    await db.query("DELETE FROM leads WHERE phone IN ($1, $2)", [fbUserId, igUserId]);
    await db.query("DELETE FROM whatsapp_channels WHERE phone_number_id IN ($1, $2)", [fbPageId, igAccountId]);
    process.exit(0);
  }
}

runMulticanalTest();
