require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// CONFIGURAÇÃO DO SUPABASE
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ ERRO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Supabase configurado:', supabaseUrl);

// MIDDLEWARES
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log de requisições
app.use((req, res, next) => {
    console.log(`📥 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// AUTENTICAÇÃO
const PORTAL_URL = process.env.PORTAL_URL || 'https://ir-comercio-portal-zcan.onrender.com';

async function verificarAutenticacao(req, res, next) {
    const publicPaths = ['/', '/health'];
    if (publicPaths.includes(req.path)) {
        return next();
    }

    const sessionToken = req.headers['x-session-token'];

    if (!sessionToken) {
        return res.status(401).json({
            error: 'Não autenticado',
            message: 'Token de sessão não encontrado'
        });
    }

    try {
        const verifyResponse = await fetch(`${PORTAL_URL}/api/verify-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken })
        });

        if (!verifyResponse.ok) {
            return res.status(401).json({
                error: 'Sessão inválida',
                message: 'Sua sessão expirou'
            });
        }

        const sessionData = await verifyResponse.json();

        if (!sessionData.valid) {
            return res.status(401).json({
                error: 'Sessão inválida',
                message: sessionData.message || 'Sua sessão expirou'
            });
        }

        req.user = sessionData.session;
        req.sessionToken = sessionToken;
        next();
    } catch (error) {
        console.error('❌ Erro ao verificar autenticação:', error);
        return res.status(500).json({
            error: 'Erro interno',
            message: 'Erro ao verificar autenticação'
        });
    }
}

// SERVIR ARQUIVOS ESTÁTICOS
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// HEALTH CHECK
app.get('/health', async (req, res) => {
    try {
        const { error } = await supabase
            .from('controle_frete')
            .select('count', { count: 'exact', head: true });
        
        res.json({
            status: error ? 'unhealthy' : 'healthy',
            database: error ? 'disconnected' : 'connected',
            timestamp: new Date().toISOString(),
            service: 'Controle de Frete API'
        });
    } catch (error) {
        res.json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ROTAS DA API
app.use('/api', verificarAutenticacao);

// GET - Listar todos os fretes
app.get('/api/fretes', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('controle_frete')
            .select('*')
            .order('data_emissao', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('❌ Erro ao buscar fretes:', error);
        res.status(500).json({ 
            error: 'Erro ao buscar fretes',
            details: error.message 
        });
    }
});

// GET - Buscar por ID
app.get('/api/fretes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('controle_frete')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ error: 'Frete não encontrado' });
        }

        res.json(data);
    } catch (error) {
        console.error('❌ Erro ao buscar frete:', error);
        res.status(500).json({ 
            error: 'Erro ao buscar frete',
            details: error.message 
        });
    }
});

// POST - Criar frete
app.post('/api/fretes', async (req, res) => {
    try {
        console.log('📝 Criando frete:', req.body);
        
        const {
            numero_nf,
            data_emissao,
            documento,
            valor_nf,
            tipo_nf,
            nome_orgao,
            contato_orgao,
            vendedor,
            transportadora,
            valor_frete,
            data_coleta,
            cidade_destino,
            previsao_entrega,
            data_entrega,
            observacoes
        } = req.body;

        // Validações mínimas
        if (!numero_nf || !nome_orgao || !data_coleta) {
            return res.status(400).json({ 
                error: 'Campos obrigatórios faltando: numero_nf, nome_orgao, data_coleta'
            });
        }

        // Calcular status baseado no tipo_nf
        let status = 'EM_TRANSITO'; // Default para ENVIO
        
        const tipoNf = tipo_nf || 'ENVIO';
        
        // Tipos que usam status: ENVIO, SIMPLES_REMESSA, REMESSA_AMOSTRA
        const tiposComStatus = ['ENVIO', 'SIMPLES_REMESSA', 'REMESSA_AMOSTRA'];
        
        // Se não for um dos tipos com status, status é null
        if (!tiposComStatus.includes(tipoNf)) {
            status = null;
        }

        const { data, error } = await supabase
            .from('controle_frete')
            .insert([{
                numero_nf,
                data_emissao: data_emissao || new Date().toISOString().split('T')[0],
                documento: documento || 'NÃO INFORMADO',
                valor_nf: valor_nf || 0,
                tipo_nf: tipoNf,
                nome_orgao,
                contato_orgao: contato_orgao || 'NÃO INFORMADO',
                vendedor: vendedor || 'NÃO INFORMADO',
                transportadora: transportadora || 'NÃO INFORMADO',
                valor_frete: valor_frete || 0,
                data_coleta,
                cidade_destino: cidade_destino || 'NÃO INFORMADO',
                previsao_entrega: previsao_entrega || null,
                data_entrega: data_entrega || null,
                status,
                observacoes: observacoes || '[]'
            }])
            .select()
            .single();

        if (error) throw error;

        console.log('✅ Frete criado:', data.id);
        res.status(201).json(data);
    } catch (error) {
        console.error('❌ Erro ao criar frete:', error);
        res.status(500).json({ 
            error: 'Erro ao criar frete',
            details: error.message 
        });
    }
});

// PUT - Atualizar frete
app.put('/api/fretes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`✏️ Atualizando frete: ${id}`);
        console.log('📦 Dados recebidos:', req.body);
        
        const {
            numero_nf,
            data_emissao,
            documento,
            valor_nf,
            tipo_nf,
            nome_orgao,
            contato_orgao,
            vendedor,
            transportadora,
            valor_frete,
            data_coleta,
            cidade_destino,
            previsao_entrega,
            data_entrega,
            observacoes
        } = req.body;

        const tipoNf = tipo_nf || 'ENVIO';
        
        // Tipos que usam status: ENVIO, SIMPLES_REMESSA, REMESSA_AMOSTRA
        const tiposComStatus = ['ENVIO', 'SIMPLES_REMESSA', 'REMESSA_AMOSTRA'];
        
        // LÓGICA DE STATUS ATUALIZADA:
        // 1. Se não é tipo com status → status = null
        // 2. Se tem data_entrega definida → status = ENTREGUE (data_entrega tem prioridade)
        // 3. Se não tem data_entrega → status = EM_TRANSITO (padrão)
        
        let status;
        
        if (!tiposComStatus.includes(tipoNf)) {
            // Tipos especiais não têm status
            status = null;
        } else if (data_entrega) {
            // Se tem data de entrega, está ENTREGUE (prioridade máxima)
            status = 'ENTREGUE';
            console.log(`✅ Status definido como ENTREGUE (data_entrega: ${data_entrega})`);
        } else {
            // Se não tem data de entrega, volta para EM_TRANSITO
            status = 'EM_TRANSITO';
            console.log(`📦 Status definido como EM_TRANSITO (sem data_entrega)`);
        }
        
        console.log(`📝 Atualizando tipo_nf para: ${tipoNf}`);
        console.log(`📝 Atualizando status para: ${status}`);

        const updateData = {
            numero_nf,
            data_emissao,
            documento,
            valor_nf,
            tipo_nf: tipoNf,
            nome_orgao,
            contato_orgao,
            vendedor,
            transportadora,
            valor_frete,
            data_coleta,
            cidade_destino,
            previsao_entrega,
            data_entrega: data_entrega || null,
            status,
            observacoes: observacoes || '[]'
        };

        const { data, error } = await supabase
            .from('controle_frete')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ error: 'Frete não encontrado' });
        }

        console.log('✅ Frete atualizado:', data);
        res.json(data);
    } catch (error) {
        console.error('❌ Erro ao atualizar frete:', error);
        res.status(500).json({ 
            error: 'Erro ao atualizar frete',
            details: error.message 
        });
    }
});

// PATCH - Toggle status (checkbox) + data_entrega
app.patch('/api/fretes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, data_entrega } = req.body;

        console.log(`🔄 Toggle status do frete ${id} para: ${status}`);
        if (data_entrega !== undefined) {
            console.log(`📅 Definindo data_entrega para: ${data_entrega}`);
        }

        // Preparar dados para atualização
        const updateData = { status };
        
        // Se data_entrega foi enviada, incluir na atualização
        if (data_entrega !== undefined) {
            updateData.data_entrega = data_entrega;
        }

        const { data, error } = await supabase
            .from('controle_frete')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({ error: 'Frete não encontrado' });
        }

        console.log('✅ Status atualizado');
        res.json(data);
    } catch (error) {
        console.error('❌ Erro ao atualizar status:', error);
        res.status(500).json({ 
            error: 'Erro ao atualizar status',
            details: error.message 
        });
    }
});

// DELETE - Excluir frete
app.delete('/api/fretes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`🗑️ Deletando frete: ${id}`);

        const { error } = await supabase
            .from('controle_frete')
            .delete()
            .eq('id', id);

        if (error) throw error;

        console.log('✅ Frete deletado');
        res.json({ message: 'Frete excluído com sucesso' });
    } catch (error) {
        console.error('❌ Erro ao excluir frete:', error);
        res.status(500).json({ 
            error: 'Erro ao excluir frete',
            details: error.message 
        });
    }
});

// ROTA PRINCIPAL
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        service: 'Controle de Frete API',
        version: '2.2.0',
        timestamp: new Date().toISOString(),
        updates: 'Adicionado suporte a data_entrega e username em observações'
    });
});

// ROTA 404
app.use((req, res) => {
    res.status(404).json({
        error: '404 - Rota não encontrada',
        path: req.path
    });
});

// TRATAMENTO DE ERROS
app.use((error, req, res, next) => {
    console.error('💥 Erro no servidor:', error);
    res.status(500).json({
        error: 'Erro interno do servidor',
        message: error.message
    });
});

// INICIAR SERVIDOR
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ================================');
    console.log(`🚀 Controle de Frete API v2.2.0`);
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Supabase URL: ${supabaseUrl}`);
    console.log(`📁 Public folder: ${publicPath}`);
    console.log(`🔐 Autenticação: Ativa`);
    console.log(`🌐 Portal URL: ${PORTAL_URL}`);
    console.log(`✨ Novo: data_entrega + username`);
    console.log('🚀 ================================\n');
});
