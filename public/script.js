// CONFIGURAÇÃO
const PORTAL_URL = 'https://ir-comercio-portal-zcan.onrender.com';
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3002/api'
    : `${window.location.origin}/api`;

const PAGE_SIZE = 50;

// Estado global de paginação
let state = {
    precos: [],
    currentPage: 1,
    totalPages: 1,
    totalRecords: 0,
    marcaSelecionada: 'TODAS',
    searchTerm: '',
    marcasDisponiveis: [],
    isLoading: false
};

let isOnline = false;
let sessionToken = null;

console.log('🚀 Tabela de Preços iniciada');
console.log('📍 API URL:', API_URL);

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
});

function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('tabelaPrecosSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('tabelaPrecosSession');
    }

    if (!sessionToken) {
        mostrarTelaAcessoNegado();
        return;
    }

    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: var(--bg-primary); color: var(--text-primary); text-align: center; padding: 2rem;">
            <h1 style="font-size: 2.2rem; margin-bottom: 1rem;">${mensagem}</h1>
            <p style="color: var(--text-secondary); margin-bottom: 2rem;">Somente usuários autenticados podem acessar esta área.</p>
            <a href="${PORTAL_URL}" style="display: inline-block; background: var(--btn-register); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Ir para o Portal</a>
        </div>
    `;
}

function inicializarApp() {
    checkServerStatus();
    setInterval(checkServerStatus, 15000);
    // Polling leve — apenas recarrega página atual se online
    setInterval(() => {
        if (isOnline && !state.isLoading) loadPrecos(state.currentPage, false);
    }, 30000);
}

// ─── AUTENTICAÇÃO / STATUS ────────────────────────────────────────────────────

function getHeaders() {
    const headers = { 'Accept': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    return headers;
}

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal, mode: 'cors' });
        clearTimeout(timeoutId);
        return response;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

async function checkServerStatus() {
    try {
        const response = await fetchWithTimeout(`${API_URL}/precos?page=1&limit=1`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (response.status === 401) {
            sessionStorage.removeItem('tabelaPrecosSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }

        const wasOffline = !isOnline;
        isOnline = response.ok;

        if (wasOffline && isOnline) {
            console.log('✅ SERVIDOR ONLINE');
            carregarMarcas();
        }

        updateConnectionStatus();
        return isOnline;
    } catch (error) {
        isOnline = false;
        updateConnectionStatus();
        return false;
    }
}

function updateConnectionStatus() {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        statusElement.className = isOnline ? 'connection-status online' : 'connection-status offline';
    }
}

// ─── MARCAS ────────────────────────────────────────────────────────────────────

async function carregarMarcas() {
    try {
        const response = await fetchWithTimeout(`${API_URL}/marcas`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (!response.ok) return;

        const marcas = await response.json();
        state.marcasDisponiveis = marcas;
        renderMarcasFilter();
        loadPrecos(1);
    } catch (error) {
        console.error('Erro ao carregar marcas:', error);
        loadPrecos(1);
    }
}

function renderMarcasFilter() {
    const container = document.getElementById('marcasFilter');
    if (!container) return;

    container.innerHTML = '';

    ['TODAS', ...state.marcasDisponiveis].forEach(marca => {
        const button = document.createElement('button');
        button.className = `brand-button ${marca === state.marcaSelecionada ? 'active' : ''}`;
        button.textContent = marca;
        button.onclick = () => selecionarMarca(marca);
        container.appendChild(button);
    });
}

function selecionarMarca(marca) {
    state.marcaSelecionada = marca;
    state.currentPage = 1;
    state.searchTerm = '';
    const searchInput = document.getElementById('search');
    if (searchInput) searchInput.value = '';
    renderMarcasFilter();
    loadPrecos(1);
}

// ─── CARREGAMENTO COM PAGINAÇÃO ────────────────────────────────────────────────

async function loadPrecos(page = 1, showLoader = true) {
    if (!isOnline) return;
    if (state.isLoading) return;

    state.isLoading = true;
    state.currentPage = page;

    if (showLoader) renderLoading();

    try {
        const params = new URLSearchParams({
            page: page,
            limit: PAGE_SIZE
        });

        if (state.marcaSelecionada && state.marcaSelecionada !== 'TODAS') {
            params.set('marca', state.marcaSelecionada);
        }

        if (state.searchTerm) {
            params.set('search', state.searchTerm);
        }

        const response = await fetchWithTimeout(`${API_URL}/precos?${params.toString()}`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (response.status === 401) {
            sessionStorage.removeItem('tabelaPrecosSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            console.error('❌ Erro ao carregar preços:', response.status);
            return;
        }

        const result = await response.json();

        // Descarta dados anteriores, usa apenas os da página atual
        state.precos = (result.data || []).map(item => ({
            ...item,
            descricao: item.descricao.toUpperCase()
        }));
        state.totalRecords = result.total || 0;
        state.totalPages = result.totalPages || 1;
        state.currentPage = result.page || page;

        renderPrecos();
        renderPaginacao();

    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('❌ Timeout ao carregar preços');
        } else {
            console.error('❌ Erro ao carregar:', error);
        }
    } finally {
        state.isLoading = false;
    }
}

function filterPrecos() {
    state.searchTerm = document.getElementById('search').value.trim();
    state.currentPage = 1;
    loadPrecos(1);
}

// ─── RENDERIZAÇÃO ──────────────────────────────────────────────────────────────

function renderLoading() {
    const container = document.getElementById('precosTableBody');
    if (container) {
        container.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 0.75rem;">
                        <div class="loader" style="width:24px;height:24px;border-width:3px;"></div>
                        Carregando...
                    </div>
                </td>
            </tr>
        `;
    }
}

function renderPrecos() {
    const container = document.getElementById('precosTableBody');
    if (!container) return;

    if (!state.precos || state.precos.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem;">
                    Nenhum preço encontrado
                </td>
            </tr>
        `;
        return;
    }

    container.innerHTML = state.precos.map(p => `
        <tr>
            <td><strong>${p.marca}</strong></td>
            <td>${p.codigo}</td>
            <td>R$ ${parseFloat(p.preco).toFixed(2)}</td>
            <td>${p.descricao}</td>
            <td style="color: var(--text-secondary); font-size: 0.85rem;">${getTimeAgo(p.timestamp)}</td>
            <td class="actions-cell" style="text-align: center;">
                <button onclick="window.editPreco('${p.id}')" class="action-btn edit">Editar</button>
                <button onclick="window.deletePreco('${p.id}')" class="action-btn delete">Excluir</button>
            </td>
        </tr>
    `).join('');
}

function renderPaginacao() {
    // Remove paginação existente
    const existingPagination = document.getElementById('paginacaoContainer');
    if (existingPagination) existingPagination.remove();

    const tableCard = document.querySelector('.table-card');
    if (!tableCard) return;

    const total = state.totalPages;
    const atual = state.currentPage;

    const inicio = state.totalRecords === 0 ? 0 : (atual - 1) * PAGE_SIZE + 1;
    const fim = Math.min(atual * PAGE_SIZE, state.totalRecords);

    // Gera botões de página (máx 7 visíveis)
    let paginas = [];
    if (total <= 7) {
        for (let i = 1; i <= total; i++) paginas.push(i);
    } else {
        paginas.push(1);
        if (atual > 3) paginas.push('...');
        for (let i = Math.max(2, atual - 1); i <= Math.min(total - 1, atual + 1); i++) {
            paginas.push(i);
        }
        if (atual < total - 2) paginas.push('...');
        paginas.push(total);
    }

    const botoesHTML = paginas.map(p => {
        if (p === '...') return `<span class="pag-ellipsis">…</span>`;
        return `<button class="pag-btn ${p === atual ? 'pag-btn-active' : ''}" onclick="loadPrecos(${p})">${p}</button>`;
    }).join('');

    const div = document.createElement('div');
    div.id = 'paginacaoContainer';
    div.className = 'paginacao-wrapper';
    div.innerHTML = `
        <div class="paginacao-info">
            ${state.totalRecords > 0 ? `Exibindo ${inicio}–${fim} de ${state.totalRecords} registros` : 'Nenhum registro'}
        </div>
        <div class="paginacao-btns">
            <button class="pag-btn pag-nav" onclick="loadPrecos(${atual - 1})" ${atual === 1 ? 'disabled' : ''}>‹</button>
            ${botoesHTML}
            <button class="pag-btn pag-nav" onclick="loadPrecos(${atual + 1})" ${atual === total ? 'disabled' : ''}>›</button>
        </div>
    `;

    tableCard.appendChild(div);
}

// ─── FORMULÁRIO ────────────────────────────────────────────────────────────────

window.toggleForm = function() {
    showFormModal(null);
};

function showFormModal(editingId = null) {
    const isEditing = editingId !== null;
    const preco = isEditing ? state.precos.find(p => p.id === editingId) : null;

    const modalHTML = `
        <div class="modal-overlay" id="formModal" style="display: flex;">
            <div class="modal-content large">
                <div class="modal-header">
                    <h3 class="modal-title">${isEditing ? 'Editar Preço' : 'Novo Preço'}</h3>
                    <button class="close-modal" onclick="closeFormModal(true)">✕</button>
                </div>
                <form id="modalPrecoForm" onsubmit="handleSubmit(event)">
                    <input type="hidden" id="modalEditId" value="${editingId || ''}">
                    <div class="form-grid">
                        <div class="form-group">
                            <label for="modalMarca">Marca *</label>
                            <input type="text" id="modalMarca" value="${preco?.marca || ''}" required>
                        </div>
                        <div class="form-group">
                            <label for="modalCodigo">Código *</label>
                            <input type="text" id="modalCodigo" value="${preco?.codigo || ''}" required>
                        </div>
                        <div class="form-group">
                            <label for="modalPreco">Preço (R$) *</label>
                            <input type="number" id="modalPreco" step="0.01" min="0" value="${preco?.preco || ''}" required>
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label for="modalDescricao">Descrição *</label>
                            <textarea id="modalDescricao" rows="3" required>${preco?.descricao || ''}</textarea>
                        </div>
                    </div>
                    <div class="modal-actions modal-actions-right">
                        <button type="submit" class="save">${isEditing ? 'Atualizar' : 'Salvar'}</button>
                        <button type="button" onclick="closeFormModal(true)" class="danger">Cancelar</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    setTimeout(() => {
        const descricaoField = document.getElementById('modalDescricao');
        descricaoField.addEventListener('input', (e) => {
            const start = e.target.selectionStart;
            e.target.value = e.target.value.toUpperCase();
            e.target.setSelectionRange(start, start);
        });

        document.getElementById('modalMarca')?.focus();
    }, 100);
}

function closeFormModal(showCancelMessage = false) {
    const modal = document.getElementById('formModal');
    if (modal) {
        const editId = document.getElementById('modalEditId')?.value;
        const isEditing = editId && editId !== '';

        if (showCancelMessage) {
            showToast(isEditing ? 'Atualização cancelada' : 'Registro cancelado', 'error');
        }

        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

async function handleSubmit(event) {
    event.preventDefault();

    const formData = {
        marca: document.getElementById('modalMarca').value.trim(),
        codigo: document.getElementById('modalCodigo').value.trim(),
        preco: parseFloat(document.getElementById('modalPreco').value),
        descricao: document.getElementById('modalDescricao').value.trim().toUpperCase()
    };

    const editId = document.getElementById('modalEditId').value;

    if (!isOnline) {
        showToast('Sistema offline', 'error');
        closeFormModal();
        return;
    }

    try {
        const url = editId ? `${API_URL}/precos/${editId}` : `${API_URL}/precos`;
        const method = editId ? 'PUT' : 'POST';

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        if (sessionToken) headers['X-Session-Token'] = sessionToken;

        const response = await fetchWithTimeout(url, {
            method,
            headers,
            body: JSON.stringify(formData)
        }, 15000);

        if (response.status === 401) {
            sessionStorage.removeItem('tabelaPrecosSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            let errorMessage = 'Erro ao salvar';
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {
                errorMessage = `Erro ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        closeFormModal();
        showToast(editId ? 'Item atualizado' : 'Item registrado', 'success');

        // Recarrega marcas e volta para p. 1 se novo, ou mantém página se edição
        await carregarMarcas();
        loadPrecos(editId ? state.currentPage : 1);

    } catch (error) {
        if (error.name === 'AbortError') {
            showToast('Timeout: Operação demorou muito', 'error');
        } else {
            showToast(`Erro: ${error.message}`, 'error');
        }
    }
}

// ─── EDITAR / EXCLUIR ──────────────────────────────────────────────────────────

window.editPreco = function(id) {
    showFormModal(id);
};

window.deletePreco = function(id) {
    showDeleteModal(id);
};

function showDeleteModal(id) {
    const modalHTML = `
        <div class="modal-overlay" id="deleteModal" style="display: flex;">
            <div class="modal-content modal-delete">
                <button class="close-modal" onclick="closeDeleteModal()">✕</button>
                <div class="modal-message-delete">
                    Tem certeza que deseja excluir este preço?
                </div>
                <div class="modal-actions modal-actions-no-border">
                    <button type="button" onclick="confirmDelete('${id}')" class="danger">Sim</button>
                    <button type="button" onclick="closeDeleteModal()" class="danger">Cancelar</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function closeDeleteModal() {
    const modal = document.getElementById('deleteModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

async function confirmDelete(id) {
    closeDeleteModal();

    if (!isOnline) {
        showToast('Sistema offline. Não foi possível excluir.', 'error');
        return;
    }

    try {
        const response = await fetchWithTimeout(`${API_URL}/precos/${id}`, {
            method: 'DELETE',
            headers: getHeaders()
        });

        if (response.status === 401) {
            sessionStorage.removeItem('tabelaPrecosSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) throw new Error('Erro ao deletar');

        showToast('Preço excluído com sucesso!', 'success');

        // Se era o último item da página, volta uma página
        const pageToLoad = state.precos.length === 1 && state.currentPage > 1
            ? state.currentPage - 1
            : state.currentPage;

        await carregarMarcas();
        loadPrecos(pageToLoad);

    } catch (error) {
        if (error.name === 'AbortError') {
            showToast('Timeout: Operação demorou muito', 'error');
        } else {
            showToast('Erro ao excluir preço', 'error');
        }
    }
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

function getTimeAgo(timestamp) {
    if (!timestamp) return 'Sem data';
    const now = new Date();
    const past = new Date(timestamp);
    const diffInSeconds = Math.floor((now - past) / 1000);
    if (diffInSeconds < 60) return `${diffInSeconds}s`;
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}min`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d`;
    return past.toLocaleDateString('pt-BR');
}

function showToast(message, type = 'success') {
    const oldMessages = document.querySelectorAll('.floating-message');
    oldMessages.forEach(msg => msg.remove());

    const messageDiv = document.createElement('div');
    messageDiv.className = `floating-message ${type}`;
    messageDiv.textContent = message;

    document.body.appendChild(messageDiv);

    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => messageDiv.remove(), 300);
    }, 3000);
}
