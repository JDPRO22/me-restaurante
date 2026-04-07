import {
    addDoc,
    collection,
    createDb,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    updateDoc,
    writeBatch
} from "./firebase.js";

let appConfig = null;
let db = null;

let produtos = [], pedidos = [], carrinho = [];
const SENHA_KEY = 'df_senha_admin';
const catNomes = { food:'Comida', drinks:'Bebida', savory:'Porção Salgada', sweet:'Porção Doce', snacks:'Lanches' };
let defaultAdminPassword = '1234';
let defaultKitchenPassword = 'cozinha';
const getSenha = () => localStorage.getItem(SENHA_KEY) || defaultAdminPassword;

const CATS_IMEDIATA = ['drinks', 'savory', 'sweet', 'snacks'];
function pedidoEhEntregaImediata(pedido) {
    return pedido.itens.every(item => {
        const prod = produtos.find(p => p.nome === item.nome);
        const cat = prod ? prod.cat : (item.cat || 'food');
        return CATS_IMEDIATA.includes(cat);
    });
}

function tocarSom() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [523,659,784,1047].forEach((f,i) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type='sine'; o.frequency.value=f;
            g.gain.setValueAtTime(0.3, ctx.currentTime+i*0.18);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+i*0.18+0.35);
            o.start(ctx.currentTime+i*0.18); o.stop(ctx.currentTime+i*0.18+0.4);
        });
    } catch(e) {}
}

const mostrarToast = window.mostrarToast = (msg) => {
    const t = document.createElement('div');
    t.innerText = msg;
    Object.assign(t.style, { position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)', background:'#1a1a2e', color:'white', padding:'12px 24px', borderRadius:'30px', fontFamily:'Nunito,sans-serif', fontWeight:'700', fontSize:'0.9rem', zIndex:'99999', opacity:'1', transition:'opacity 0.3s' });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 300); }, 2000);
};

let pedidoAtualFid = null;
let pedidoAtualStatus = null;
let pedidoBalcaoFid = null;
let pedidoBalcaoStatus = null;
let idsAnteriores = new Set();

function setLoadingSub(texto) {
    const sub = document.querySelector('.loading-sub');
    if (sub) sub.innerText = texto;
}

async function waitForAppConfig({ timeoutMs = 8000 } = {}) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
        const cfg = window.APP_CONFIG;
        if (cfg?.firebase?.apiKey) return cfg;
        await new Promise(requestAnimationFrame);
    }
    return null;
}

function startRealtimeListeners() {
    onSnapshot(collection(db,'produtos'), snap => {
        produtos=snap.docs.map(d=>({firestoreId:d.id,...d.data()}));
        const ativa=document.querySelector('.tela.ativa')?.id;
        if(ativa==='tela-cardapio') renderCardapio();
        if(ativa==='tela-admin') renderAdmin();
        if(ativa==='tela-balcao') renderBalcaoCardapio();
    });

    onSnapshot(query(collection(db,'pedidos'),orderBy('timestamp','asc')), snap => {
        const novosIds=new Set(snap.docs.map(d=>d.id));
        const temNovo=snap.docs.some(d=>!idsAnteriores.has(d.id)&&idsAnteriores.size>0);
        idsAnteriores=novosIds;
        pedidos=snap.docs.map(d=>({firestoreId:d.id,...d.data()}));
        if(pedidoAtualFid) {
            const pedAtual = pedidos.find(p=>p.firestoreId===pedidoAtualFid);
            if(pedAtual && pedAtual.status==='pronto' && pedidoAtualStatus!=='pronto') {
                pedidoAtualStatus = 'pronto';
                tocarSom();
                document.querySelectorAll('.tela').forEach(t=>t.classList.remove('ativa'));
                document.getElementById('tela-pedido-pronto').classList.add('ativa');
            }
        }
        if(pedidoBalcaoFid) {
            const pedBalcao = pedidos.find(p=>p.firestoreId===pedidoBalcaoFid);
            if(pedBalcao && pedBalcao.status==='pronto' && pedidoBalcaoStatus!=='pronto') {
                pedidoBalcaoStatus = 'pronto';
                tocarSom();
                document.getElementById('balcao-notif-num').innerText = `#${pedBalcao.id}`;
                document.getElementById('balcao-notif-cliente').innerText = pedBalcao.cliente ? `${pedBalcao.cliente} — Pronto para retirada` : 'Pronto para retirada';
                document.getElementById('balcao-notif-pronto').classList.add('ativa');
                document.getElementById('balcao-notif-pronto').scrollIntoView({behavior:'smooth', block:'center'});
            }
        }
        if(temNovo) tocarSom();
        const ativa=document.querySelector('.tela.ativa')?.id;
        if(ativa==='tela-cozinha') renderCozinha();
        if(ativa==='tela-admin') renderAdmin();
    });

    getDoc(doc(db,'config','restaurante')).then(d=>{
        if(d.exists()&&d.data().whatsapp) localStorage.setItem('df_wa',d.data().whatsapp);
    }).catch(()=>{});
}

async function bootstrap() {
    const cfg = await waitForAppConfig();
    if (!cfg?.firebase?.apiKey) {
        setLoadingSub('Configuração ausente (js/config.js)');
        throw new Error('APP_CONFIG ausente. Crie js/config.js (copie de js/config.template.js) ou configure o deploy com secrets.');
    }

    appConfig = cfg;
    defaultAdminPassword = appConfig?.secrets?.adminPasswordDefault || '1234';
    defaultKitchenPassword = appConfig?.secrets?.kitchenPasswordDefault || 'cozinha';
    db = createDb(appConfig.firebase);

    startRealtimeListeners();
    await init();
}

function scheduleBootstrap() {
    queueMicrotask(() => bootstrap().catch(console.error));
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', scheduleBootstrap, { once: true });
} else {
    scheduleBootstrap();
}

const fecharNotifBalcao = window.fecharNotifBalcao = () => {
    document.getElementById('balcao-notif-pronto').classList.remove('ativa');
    pedidoBalcaoFid = null;
    pedidoBalcaoStatus = null;
};

const fecharPedidoPronto = window.fecharPedidoPronto = () => {
    document.getElementById('tela-pedido-pronto').classList.remove('ativa');
    pedidoAtualFid = null; pedidoAtualStatus = null;
    irPara('tela-cardapio');
};

const irPara = window.irPara = (id) => {
    document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
    document.getElementById(id)?.classList.add('ativa');
    if (id === 'tela-cardapio') renderCardapio();
    if (id === 'tela-admin') renderAdmin();
    if (id === 'tela-cozinha') renderCozinha();
    if (id === 'tela-balcao') { renderBalcaoCardapio(); renderCarrinhoBalcao(); }
    if (id === 'tela-relatorio') { iniciarRelatorio(); }
};
const abrirModal = window.abrirModal = (id) => document.getElementById(id).classList.add('ativa');
const fecharModal = window.fecharModal = (id) => document.getElementById(id).classList.remove('ativa');
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if(e.target===m) fecharModal(m.id); }));

const acessoAdmin = window.acessoAdmin = () => { document.getElementById('input-senha-acesso').value=''; abrirModal('modal-senha'); setTimeout(()=>document.getElementById('input-senha-acesso').focus(),100); };
const confirmarSenhaAdmin = window.confirmarSenhaAdmin = () => {
    if (document.getElementById('input-senha-acesso').value === getSenha()) { fecharModal('modal-senha'); irPara('tela-admin'); }
    else { document.getElementById('input-senha-acesso').style.border='2px solid red'; setTimeout(()=>document.getElementById('input-senha-acesso').style.border='',1500); alert('Senha incorreta!'); }
};
document.getElementById('input-senha-acesso').addEventListener('keydown', e => { if(e.key==='Enter') window.confirmarSenhaAdmin(); });

const trocarSenha = window.trocarSenha = () => {
    const tipo=document.getElementById('trocar-senha-tipo').value;
    const chave = tipo==='cozinha' ? 'df_senha_cozinha' : SENHA_KEY;
    const senhaAtual = tipo==='cozinha' ? (localStorage.getItem('df_senha_cozinha')||defaultKitchenPassword) : getSenha();
    const atual=document.getElementById('senha-atual').value, nova=document.getElementById('senha-nova').value, conf=document.getElementById('senha-confirma').value;
    if(atual!==senhaAtual) return alert('Senha atual incorreta!');
    if(nova.length<4) return alert('Mínimo 4 caracteres.');
    if(nova!==conf) return alert('Senhas não coincidem!');
    localStorage.setItem(chave,nova); fecharModal('modal-trocar-senha');
    mostrarToast(`✅ Senha ${tipo==='cozinha'?'da cozinha':'do admin'} alterada!`);
    ['senha-atual','senha-nova','senha-confirma'].forEach(id=>document.getElementById(id).value='');
};
const abrirModalTrocarSenha = window.abrirModalTrocarSenha = (tipo) => {
    document.getElementById('trocar-senha-tipo').value=tipo;
    document.getElementById('trocar-senha-titulo').innerText = tipo==='cozinha' ? '🍳 Alterar Senha da Cozinha' : '🔒 Alterar Senha do Admin';
    ['senha-atual','senha-nova','senha-confirma'].forEach(id=>document.getElementById(id).value='');
    abrirModal('modal-trocar-senha');
};
const acessoCozinha = window.acessoCozinha = () => { document.getElementById('input-senha-cozinha').value=''; abrirModal('modal-senha-cozinha'); setTimeout(()=>document.getElementById('input-senha-cozinha').focus(),100); };
const confirmarSenhaCozinha = window.confirmarSenhaCozinha = () => {
    const senhaCozinha = localStorage.getItem('df_senha_cozinha') || defaultKitchenPassword;
    if(document.getElementById('input-senha-cozinha').value===senhaCozinha){ fecharModal('modal-senha-cozinha'); irPara('tela-cozinha'); }
    else { document.getElementById('input-senha-cozinha').style.border='2px solid red'; setTimeout(()=>document.getElementById('input-senha-cozinha').style.border='',1500); alert('Senha incorreta!'); }
};
document.getElementById('input-senha-cozinha').addEventListener('keydown', e=>{ if(e.key==='Enter') window.confirmarSenhaCozinha(); });

let consumoSelecionado = 'aqui';
const selecionarConsumo = window.selecionarConsumo = (tipo) => {
    consumoSelecionado = tipo;
    document.getElementById('opcao-aqui').classList.toggle('selecionado', tipo==='aqui');
    document.getElementById('opcao-levar').classList.toggle('selecionado', tipo==='levar');
};

const addCarrinho = window.addCarrinho = (fid) => {
    const p = produtos.find(x=>x.firestoreId===fid); if(!p) return;
    document.getElementById('modal-add-fid').value = fid;
    document.getElementById('modal-add-titulo').innerText = p.nome;
    document.getElementById('modal-add-preco').innerText = `R$ ${p.preco.toFixed(2)}`;
    document.getElementById('modal-add-obs').value = '';
    consumoSelecionado = 'aqui';
    document.getElementById('opcao-aqui').classList.add('selecionado');
    document.getElementById('opcao-levar').classList.remove('selecionado');
    abrirModal('modal-adicionar-produto');
    setTimeout(()=>document.getElementById('modal-add-obs').focus(), 200);
};

window.confirmarAddCarrinho = () => {
    const fid = document.getElementById('modal-add-fid').value;
    const obs = document.getElementById('modal-add-obs').value.trim();
    const p = produtos.find(x=>x.firestoreId===fid); if(!p) return;
    carrinho.push({...p, _uid:Date.now()+Math.random(), consumo:consumoSelecionado, obs});
    document.getElementById('cart-count').innerText = carrinho.length;
    fecharModal('modal-adicionar-produto');
    mostrarToast(`✅ ${p.nome} adicionado!`);
};

window.adicionarProduto = async () => {
    const nome=document.getElementById('p-nome').value.trim(), preco=parseFloat(document.getElementById('p-preco').value);
    const cat=document.getElementById('p-cat').value, promo=document.getElementById('p-promo').value;
    const fotoFile=document.getElementById('p-foto').files[0];
    if(!nome||isNaN(preco)||preco<=0) return alert('Preencha nome e preço!');
    const salvar = async(foto) => {
        await addDoc(collection(db,'produtos'),{id:Date.now(),nome,preco,cat,promo,foto:foto||''});
        document.getElementById('p-nome').value=''; document.getElementById('p-preco').value=''; document.getElementById('p-foto').value='';
        mostrarToast('✅ Produto cadastrado!');
    };
    if(fotoFile){const r=new FileReader();r.onload=e=>salvar(e.target.result);r.readAsDataURL(fotoFile);}else{await salvar('');}
};
window.excluirProduto = async(fid) => { if(confirm('Excluir este produto?')) await deleteDoc(doc(db,'produtos',fid)); };
window.editarProduto = (fid) => {
    const p=produtos.find(x=>x.firestoreId===fid); if(!p) return;
    document.getElementById('edit-id').value=fid; document.getElementById('edit-nome').value=p.nome;
    document.getElementById('edit-preco').value=p.preco; document.getElementById('edit-cat').value=p.cat;
    document.getElementById('edit-promo').value=p.promo; document.getElementById('edit-foto').value='';
    abrirModal('modal-editar-produto');
};
window.salvarEdicaoProduto = async() => {
    const fid=document.getElementById('edit-id').value, nome=document.getElementById('edit-nome').value.trim();
    const preco=parseFloat(document.getElementById('edit-preco').value), cat=document.getElementById('edit-cat').value;
    const promo=document.getElementById('edit-promo').value, fotoFile=document.getElementById('edit-foto').files[0];
    if(!nome||isNaN(preco)||preco<=0) return alert('Preencha nome e preço!');
    const p=produtos.find(x=>x.firestoreId===fid); if(!p) return;
    const aplicar = async(foto) => {
        const atualizado={...p,nome,preco,cat,promo}; if(foto!==null) atualizado.foto=foto;
        delete atualizado.firestoreId;
        await setDoc(doc(db,'produtos',fid),atualizado);
        fecharModal('modal-editar-produto'); mostrarToast('✅ Produto atualizado!');
    };
    if(fotoFile){const r=new FileReader();r.onload=e=>aplicar(e.target.result);r.readAsDataURL(fotoFile);}else{await aplicar(null);}
};

function renderCardapio() {
    ['food','drinks','savory','sweet','snacks'].forEach(cat => {
        const div=document.getElementById(`lista-${cat}`); div.innerHTML='';
        const filtrados=produtos.filter(p=>p.cat===cat);
        if(!filtrados.length){div.innerHTML='<p style="color:var(--muted);padding:10px 0;font-size:0.9rem;">Nenhum item nesta categoria.</p>';return;}
        filtrados.forEach(p=>{
            div.innerHTML+=`<div class="card">${p.promo==='sim'?'<span class="badge-promo">🔥 Promoção</span>':''}
            <img src="${p.foto||'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop'}" alt="${p.nome}" loading="lazy">
            <div class="card-info"><h4>${p.nome}</h4><div class="preco">R$ ${p.preco.toFixed(2)}</div>
            <button class="btn btn-nav" style="width:100%;margin-top:6px;" onclick="addCarrinho('${p.firestoreId}')">+ Adicionar</button></div></div>`;
        });
    });
}

window.abrirCarrinho = () => { irPara('tela-carrinho'); renderCarrinho(); };
function renderCarrinho() {
    const div=document.getElementById('itens-carrinho'); div.innerHTML=''; let total=0;
    if(!carrinho.length){div.innerHTML='<p style="color:var(--muted);text-align:center;padding:20px;">Carrinho vazio!</p>';document.getElementById('total-carrinho').innerText='R$ 0,00';return;}
    carrinho.forEach((item,i)=>{
        total+=item.preco;
        const consumoLabel = item.consumo==='levar' ? '🥡 Para levar' : '🍽️ Consumir aqui';
        const obsHtml = item.obs ? `<div class="cart-item-detalhe">📝 ${item.obs}</div>` : '';
        div.innerHTML+=`<div class="cart-item">
            <div style="flex:1;">
                <div class="cart-item-nome">${item.nome}</div>
                <div class="cart-item-detalhe">${consumoLabel}</div>
                ${obsHtml}
            </div>
            <span style="display:flex;align-items:center;gap:4px;">
                <span class="cart-item-preco">R$ ${item.preco.toFixed(2)}</span>
                <button class="remove-btn" onclick="removerItem(${i})">🗑</button>
            </span>
        </div>`;
    });
    document.getElementById('total-carrinho').innerText=`R$ ${total.toFixed(2)}`;
}
window.removerItem = (i) => { carrinho.splice(i,1); document.getElementById('cart-count').innerText=carrinho.length; renderCarrinho(); };

window.finalizarPedido = async() => {
    const nome=document.getElementById('cliente-nome').value.trim();
    const pag=document.getElementById('cliente-pagamento').value;
    const obsGeral=document.getElementById('obs-geral').value.trim();
    const zap=localStorage.getItem('df_wa')||'';
    if(!carrinho.length) return alert('Carrinho vazio!');
    if(!nome) return alert('Digite seu nome!');
    if(!zap) return alert('WhatsApp não configurado no Admin!');
    const total=carrinho.reduce((a,p)=>a+p.preco,0);
    const num=pedidos.length+1;
    const agora=new Date();
    const pedido={
        id:num, cliente:nome, total,
        itens:carrinho.map(i=>({nome:i.nome, preco:i.preco, cat:i.cat||'food', consumo:i.consumo||'aqui', obs:i.obs||''})),
        pagamento:pag, obsGeral:obsGeral,
        hora:agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),
        timestamp:agora.getTime(), status:'pendente'
    };
    let docRef;
    try{ docRef = await addDoc(collection(db,'pedidos'),pedido); }
    catch(e){ alert('Erro ao salvar pedido: '+e.message); return; }
    pedidoAtualFid = docRef.id; pedidoAtualStatus = 'pendente';

    let msg=`🍽️ *RESTAURANTE DEUS É FIEL*\n━━━━━━━━━━━━━━━━━\n📌 *Pedido Nº ${num}*\n👤 *Cliente:* ${nome}\n💳 *Pagamento:* ${pag}\n🕐 *Hora:* ${pedido.hora}\n━━━━━━━━━━━━━━━━━\n`;
    carrinho.forEach(i=>{
        const consumoLabel = i.consumo==='levar' ? '🥡 Para levar' : '🍽️ Consumir aqui';
        msg+=`• ${i.nome} — R$ ${i.preco.toFixed(2)} (${consumoLabel})`;
        if(i.obs) msg+=`\n  📝 ${i.obs}`;
        msg+='\n';
    });
    msg+=`━━━━━━━━━━━━━━━━━\n💰 *TOTAL: R$ ${total.toFixed(2)}*`;
    if(obsGeral) msg+=`\n📋 *Obs. geral:* ${obsGeral}`;
    msg+=`\n_Enviado pelo sistema digital_ 🙏`;
    window.open(`https://wa.me/${zap}?text=${encodeURIComponent(msg)}`);
    tocarSom();
    document.getElementById('badge-numero-pedido').innerText=`#${num}`;
    const comproItens = pedido.itens.map(i=>{
        let linha=`<p>${i.nome} .......... R$ ${i.preco.toFixed(2)}</p>`;
        linha+=`<p style="font-size:0.8rem;color:#888;margin-left:8px;">${i.consumo==='levar'?'🥡 Para levar':'🍽️ Consumir aqui'}${i.obs?' — '+i.obs:''}</p>`;
        return linha;
    }).join('');
    document.getElementById('comprovante-print').innerHTML=`<h3>ME Restaurante e Lanchonete</h3><hr class="comprovante-divider"><p><b>PEDIDO Nº:</b> #${pedido.id}</p><p><b>CLIENTE:</b> ${pedido.cliente}</p><p><b>HORA:</b> ${pedido.hora}</p><p><b>PAGAMENTO:</b> ${pedido.pagamento}</p><hr class="comprovante-divider">${comproItens}<hr class="comprovante-divider"><h4 style="text-align:right;">TOTAL: R$ ${pedido.total.toFixed(2)}</h4>${obsGeral?`<p style="margin-top:8px;font-size:0.85rem;"><b>Obs:</b> ${obsGeral}</p>`:''}<p style="text-align:center;margin-top:16px;">✨ Obrigado pela preferência! ✨</p>`;
    carrinho=[]; document.getElementById('cart-count').innerText='0';
    document.getElementById('cliente-nome').value='';
    document.getElementById('obs-geral').value='';
    document.getElementById('cliente-pagamento').selectedIndex=0;
    irPara('tela-comprovante');
};

function renderCozinha() {
    const grid=document.getElementById('kitchen-pedidos'); grid.innerHTML='';
    const pendentes=pedidos.filter(p=>p.status!=='entregue').sort((a,b)=>a.timestamp-b.timestamp);
    if(!pendentes.length){grid.innerHTML=`<div class="kitchen-empty"><span>🍽️</span><p style="color:#555;">Nenhum pedido pendente.<br>Os pedidos aparecem aqui em tempo real.</p></div>`;return;}
    pendentes.forEach(p=>{
        const isNovo=(Date.now()-p.timestamp)<120000, isPronto=p.status==='pronto';
        const isImediata = pedidoEhEntregaImediata(p);
        const headerClass = isPronto ? 'pronto' : (isImediata ? 'entrega' : '');
        const cardClass = (isNovo&&!isPronto) ? 'novo' : (isPronto ? 'pronto' : '');
        let acaoBtn = isPronto
            ? `<button class="btn-pronto" onclick="marcarEntregue('${p.firestoreId}')">✅ Marcar Entregue</button>`
            : isImediata
                ? `<button class="btn-entregar" onclick="marcarEntregue('${p.firestoreId}')">🛵 Entregar</button>`
                : `<button class="btn-pronto" onclick="marcarPronto('${p.firestoreId}')">🔔 Pronto!</button>`;
        const itensHtml = p.itens.map(i=>{
            const consumoBadge = i.consumo==='levar'
                ? '<span class="kitchen-item-consumo consumo-levar">Para Levar</span>'
                : '<span class="kitchen-item-consumo consumo-aqui">Aqui</span>';
            const obsHtml = i.obs ? `<div class="kitchen-item-obs">📝 ${i.obs}</div>` : '';
            return `<div class="kitchen-item"><div class="kitchen-item-nome">${i.nome}${consumoBadge}</div>${obsHtml}</div>`;
        }).join('');
        const obsGeralHtml = p.obsGeral ? `<div class="kitchen-obs-geral"><strong>📋 Obs. Geral</strong>${p.obsGeral}</div>` : '';
        grid.innerHTML+=`<div class="kitchen-card ${cardClass}">
            <div class="kitchen-card-header ${headerClass}">
                <div><div class="kitchen-numero">#${p.id}</div><div class="kitchen-hora">${p.hora}</div></div>
                <div style="text-align:right;"><div class="kitchen-cliente">${p.cliente}</div><div style="font-size:0.8rem;opacity:0.85;margin-top:4px;">${p.pagamento}</div></div>
            </div>
            <div class="kitchen-itens">${itensHtml}</div>
            ${obsGeralHtml}
            <div class="kitchen-actions">${acaoBtn}<button class="btn-excluir-pedido" onclick="excluirPedidoCozinha('${p.firestoreId}')">✕</button></div>
        </div>`;
    });
}
window.marcarPronto = async(fid) => { await updateDoc(doc(db,'pedidos',fid),{status:'pronto'}); tocarSom(); };
window.marcarEntregue = async(fid) => { await updateDoc(doc(db,'pedidos',fid),{status:'entregue'}); };
window.excluirPedidoCozinha = async(fid) => { if(confirm('Remover da fila?')) await deleteDoc(doc(db,'pedidos',fid)); };

setInterval(()=>{ const el=document.getElementById('kitchen-clock'); if(el) el.innerText=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}); },1000);

function renderAdmin() {
    const total=pedidos.reduce((a,p)=>a+p.total,0);
    document.getElementById('adm-vendas-total').innerText=`R$ ${total.toFixed(2)}`;
    document.getElementById('adm-num-pedidos').innerText=pedidos.length;
    document.getElementById('adm-num-produtos').innerText=produtos.length;
    document.getElementById('adm-wa-num').value=localStorage.getItem('df_wa')||'';
    const lp=document.getElementById('adm-lista-pedidos'); lp.innerHTML='';
    [...pedidos].sort((a,b)=>b.timestamp-a.timestamp).forEach(p=>{
        const s=p.status==='pronto'?'🟢':p.status==='entregue'?'✅':'🟡';
        const clienteEsc=p.cliente.replace(/'/g,"\\'");
        lp.innerHTML+=`<tr><td><b>#${p.id}</b></td><td>${p.cliente}</td><td>${p.pagamento}</td><td>R$ ${p.total.toFixed(2)}</td><td>${p.hora} ${s}</td>
        <td><button onclick="solicitarExclusaoPedido('${p.firestoreId}',${p.id},'${clienteEsc}',${p.total},'${p.hora}')" class="btn btn-danger" style="padding:5px 10px;font-size:0.75rem;">🗑 Excluir</button></td></tr>`;
    });
    if(!pedidos.length) lp.innerHTML='<tr><td colspan="6" style="color:var(--muted);text-align:center;">Nenhum pedido ainda.</td></tr>';
    const lprod=document.getElementById('adm-lista-produtos'); lprod.innerHTML='';
    produtos.forEach(p=>{
        lprod.innerHTML+=`<tr><td>${p.nome}</td><td>${catNomes[p.cat]||p.cat}</td><td>R$ ${p.preco.toFixed(2)}</td><td>${p.promo==='sim'?'🔥 Sim':'—'}</td>
        <td style="white-space:nowrap;"><button onclick="editarProduto('${p.firestoreId}')" class="btn" style="padding:6px 11px;font-size:0.78rem;background:#2d6a9f;color:white;margin-right:4px;">✏️ Editar</button>
        <button onclick="excluirProduto('${p.firestoreId}')" class="btn btn-danger" style="padding:6px 11px;font-size:0.78rem;">🗑 Excluir</button></td></tr>`;
    });
    if(!produtos.length) lprod.innerHTML='<tr><td colspan="5" style="color:var(--muted);text-align:center;">Nenhum produto.</td></tr>';
}

window.salvarConfig = async() => {
    const num=document.getElementById('adm-wa-num').value.replace(/\D/g,'');
    if(!num) return alert('Digite um número válido.');
    localStorage.setItem('df_wa',num);
    await setDoc(doc(db,'config','restaurante'),{whatsapp:num});
    mostrarToast('✅ WhatsApp salvo!');
};

window.limparSistema = () => {
    document.getElementById('zerar-senha').value='';
    document.getElementById('zerar-etapa-1').style.display='block';
    document.getElementById('zerar-etapa-2').style.display='none';
    abrirModal('modal-zerar');
};
window.zerarEtapa1 = () => {
    if(document.getElementById('zerar-senha').value!==getSenha()){
        document.getElementById('zerar-senha').style.border='2px solid red';
        setTimeout(()=>document.getElementById('zerar-senha').style.border='',1500);
        return alert('Senha incorreta!');
    }
    document.getElementById('zerar-etapa-1').style.display='none';
    document.getElementById('zerar-etapa-2').style.display='block';
};
window.confirmarZerarSistema = async() => {
    try {
        const batch=writeBatch(db);
        (await getDocs(collection(db,'pedidos'))).forEach(d=>batch.delete(d.ref));
        (await getDocs(collection(db,'produtos'))).forEach(d=>batch.delete(d.ref));
        await batch.commit();
        fecharModal('modal-zerar'); mostrarToast('🗑️ Sistema zerado!');
    } catch(e){ alert('Erro: '+e.message); }
};

window.solicitarExclusaoPedido = (fid,id,cliente,total,hora) => {
    document.getElementById('excluir-pedido-id').value=fid;
    document.getElementById('excluir-pedido-senha').value='';
    document.getElementById('excluir-pedido-senha').style.border='';
    document.getElementById('excluir-pedido-info').innerText=`Pedido #${id} — ${cliente} — R$ ${parseFloat(total).toFixed(2)} — ${hora}`;
    document.getElementById('excluir-pedido-etapa-1').style.display='block';
    document.getElementById('excluir-pedido-etapa-2').style.display='none';
    abrirModal('modal-excluir-pedido');
    setTimeout(()=>document.getElementById('excluir-pedido-senha').focus(),120);
};
window.excluirPedidoEtapa1 = () => {
    if(document.getElementById('excluir-pedido-senha').value!==getSenha()){
        document.getElementById('excluir-pedido-senha').style.border='2px solid red';
        setTimeout(()=>document.getElementById('excluir-pedido-senha').style.border='',1500);
        return alert('Senha incorreta!');
    }
    document.getElementById('excluir-pedido-etapa-1').style.display='none';
    document.getElementById('excluir-pedido-etapa-2').style.display='block';
};
window.confirmarExclusaoPedido = async() => {
    await deleteDoc(doc(db,'pedidos',document.getElementById('excluir-pedido-id').value));
    fecharModal('modal-excluir-pedido'); mostrarToast('🗑️ Pedido excluído.');
};

async function init() {
    try {
        const [ps,pds] = await Promise.all([getDocs(collection(db,'produtos')), getDocs(query(collection(db,'pedidos'),orderBy('timestamp','asc')))]);
        produtos=ps.docs.map(d=>({firestoreId:d.id,...d.data()}));
        pedidos=pds.docs.map(d=>({firestoreId:d.id,...d.data()}));
        idsAnteriores=new Set(pds.docs.map(d=>d.id));
        renderCardapio();
        const ol=document.getElementById('loading-overlay');
        ol.classList.add('hide'); setTimeout(()=>ol.style.display='none',600);
    } catch(e) {
        document.querySelector('.loading-sub').innerText='Erro de conexão com Firebase';
        console.error(e);
    }
}

function iniciarRelatorio() {
    const hoje = new Date().toISOString().split('T')[0];
    const input = document.getElementById('rel-data');
    if (!input.value) input.value = hoje;
    input.addEventListener('change', renderRelatorio);
    renderRelatorio();
}

function getPedidosDoDia(dataStr) {
    if (!dataStr) return pedidos;
    return pedidos.filter(p => {
        const d = new Date(p.timestamp);
        const ds = d.toLocaleDateString('sv-SE');
        return ds === dataStr;
    });
}

function renderRelatorio() {
    const dataStr = document.getElementById('rel-data').value;
    const lista = getPedidosDoDia(dataStr);

    const total = lista.reduce((a, p) => a + p.total, 0);
    const numItens = lista.reduce((a, p) => a + (p.itens ? p.itens.length : 0), 0);
    const ticket = lista.length ? total / lista.length : 0;

    document.getElementById('rel-total-vendas').innerText = `R$ ${total.toFixed(2)}`;
    document.getElementById('rel-num-pedidos').innerText = lista.length;
    document.getElementById('rel-num-itens').innerText = numItens;
    document.getElementById('rel-ticket-medio').innerText = `R$ ${ticket.toFixed(2)}`;

    const pagMap = {};
    lista.forEach(p => {
        if (!pagMap[p.pagamento]) pagMap[p.pagamento] = { qtd: 0, total: 0 };
        pagMap[p.pagamento].qtd++;
        pagMap[p.pagamento].total += p.total;
    });
    const tbPag = document.getElementById('rel-pagamentos');
    tbPag.innerHTML = '';
    if (!Object.keys(pagMap).length) {
        tbPag.innerHTML = '<tr><td colspan="3" style="color:var(--muted);text-align:center;">Nenhum dado.</td></tr>';
    } else {
        Object.entries(pagMap).sort((a,b) => b[1].total - a[1].total).forEach(([pag, v]) => {
            tbPag.innerHTML += `<tr><td>${pag}</td><td>${v.qtd}</td><td>R$ ${v.total.toFixed(2)}</td></tr>`;
        });
    }

    const prodMap = {};
    lista.forEach(p => {
        (p.itens || []).forEach(item => {
            if (!prodMap[item.nome]) prodMap[item.nome] = { qtd: 0, total: 0 };
            prodMap[item.nome].qtd++;
            prodMap[item.nome].total += item.preco;
        });
    });
    const tbProd = document.getElementById('rel-produtos-mais');
    tbProd.innerHTML = '';
    if (!Object.keys(prodMap).length) {
        tbProd.innerHTML = '<tr><td colspan="3" style="color:var(--muted);text-align:center;">Nenhum dado.</td></tr>';
    } else {
        Object.entries(prodMap).sort((a,b) => b[1].qtd - a[1].qtd).forEach(([nome, v]) => {
            tbProd.innerHTML += `<tr><td>${nome}</td><td>${v.qtd}</td><td>R$ ${v.total.toFixed(2)}</td></tr>`;
        });
    }

    const tbPed = document.getElementById('rel-lista-pedidos');
    tbPed.innerHTML = '';
    if (!lista.length) {
        tbPed.innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;">Nenhum pedido neste dia.</td></tr>';
    } else {
        [...lista].sort((a,b) => b.timestamp - a.timestamp).forEach(p => {
            const s = p.status === 'pronto' ? '🟢 Pronto' : p.status === 'entregue' ? '✅ Entregue' : '🟡 Pendente';
            tbPed.innerHTML += `<tr><td><b>#${p.id}</b></td><td>${p.cliente}</td><td>${p.pagamento}</td><td>R$ ${p.total.toFixed(2)}</td><td>${p.hora}</td><td>${s}</td></tr>`;
        });
    }
}

window.gerarPdfRelatorio = () => {
    const dataStr = document.getElementById('rel-data').value;
    const lista = getPedidosDoDia(dataStr);
    const dataFmt = dataStr ? new Date(dataStr + 'T12:00:00').toLocaleDateString('pt-BR') : 'Todos os dias';
    const total = lista.reduce((a, p) => a + p.total, 0);
    const numItens = lista.reduce((a, p) => a + (p.itens ? p.itens.length : 0), 0);
    const ticket = lista.length ? total / lista.length : 0;

    const pagMap = {};
    lista.forEach(p => {
        if (!pagMap[p.pagamento]) pagMap[p.pagamento] = { qtd: 0, total: 0 };
        pagMap[p.pagamento].qtd++;
        pagMap[p.pagamento].total += p.total;
    });

    const prodMap = {};
    lista.forEach(p => {
        (p.itens || []).forEach(item => {
            if (!prodMap[item.nome]) prodMap[item.nome] = { qtd: 0, total: 0 };
            prodMap[item.nome].qtd++;
            prodMap[item.nome].total += item.preco;
        });
    });

    const pagRows = Object.entries(pagMap).sort((a,b) => b[1].total - a[1].total)
        .map(([pag, v]) => `<tr><td>${pag}</td><td style="text-align:center;">${v.qtd}</td><td style="text-align:right;">R$ ${v.total.toFixed(2)}</td></tr>`).join('') ||
        '<tr><td colspan="3" style="text-align:center;color:#999;">Nenhum dado.</td></tr>';

    const prodRows = Object.entries(prodMap).sort((a,b) => b[1].qtd - a[1].qtd)
        .map(([nome, v]) => `<tr><td>${nome}</td><td style="text-align:center;">${v.qtd}</td><td style="text-align:right;">R$ ${v.total.toFixed(2)}</td></tr>`).join('') ||
        '<tr><td colspan="3" style="text-align:center;color:#999;">Nenhum dado.</td></tr>';

    const pedRows = [...lista].sort((a,b) => a.timestamp - b.timestamp)
        .map(p => {
            const s = p.status === 'entregue' ? 'Entregue' : p.status === 'pronto' ? 'Pronto' : 'Pendente';
            return `<tr><td>#${p.id}</td><td>${p.cliente}</td><td>${p.pagamento}</td><td style="text-align:right;">R$ ${p.total.toFixed(2)}</td><td>${p.hora}</td><td>${s}</td></tr>`;
        }).join('') || '<tr><td colspan="6" style="text-align:center;color:#999;">Nenhum pedido.</td></tr>';

    const html = `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Relatório de Pedidos - ${dataFmt}</title>
<style>
  body { font-family: Arial, sans-serif; color: #222; margin: 0; padding: 30px; font-size: 13px; }
  h1 { font-size: 1.5rem; color: #1a1a2e; margin-bottom: 2px; }
  .sub { color: #e8810a; font-size: 0.8rem; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 20px; }
  .data { font-size: 0.85rem; color: #555; margin-bottom: 20px; }
  .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .stat { background: #1a1a2e; color: white; border-radius: 10px; padding: 14px 20px; text-align: center; flex: 1; min-width: 120px; }
  .stat-val { font-size: 1.4rem; font-weight: 900; color: #f5a623; display: block; }
  .stat-lbl { font-size: 0.7rem; opacity: 0.75; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; display: block; }
  h2 { font-size: 1rem; color: #1a1a2e; border-left: 4px solid #e8810a; padding-left: 10px; margin: 20px 0 10px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12px; }
  th { background: #1a1a2e; color: white; padding: 9px 10px; text-align: left; font-size: 0.75rem; }
  td { padding: 8px 10px; border-bottom: 1px solid #e8e0d5; }
  tr:nth-child(even) td { background: #fdf9f4; }
  .footer { margin-top: 30px; border-top: 1px dashed #ccc; padding-top: 14px; text-align: center; color: #999; font-size: 0.78rem; }
  @media print { body { padding: 18px; } }
</style>
</head>
<body>
<h1>📊 Relatório de Pedidos</h1>
<div class="sub">ME Restaurante e Lanchonete</div>
<div class="data">📅 Data: <b>${dataFmt}</b> &nbsp;|&nbsp; 🕐 Gerado em: ${new Date().toLocaleString('pt-BR')}</div>

<div class="stats">
  <div class="stat"><span class="stat-val">R$ ${total.toFixed(2)}</span><span class="stat-lbl">Total em Vendas</span></div>
  <div class="stat"><span class="stat-val">${lista.length}</span><span class="stat-lbl">Pedidos</span></div>
  <div class="stat"><span class="stat-val">${numItens}</span><span class="stat-lbl">Itens Vendidos</span></div>
  <div class="stat"><span class="stat-val">R$ ${ticket.toFixed(2)}</span><span class="stat-lbl">Ticket Médio</span></div>
</div>

<h2>💳 Vendas por Forma de Pagamento</h2>
<table>
  <thead><tr><th>Forma de Pagamento</th><th>Qtd Pedidos</th><th>Total</th></tr></thead>
  <tbody>${pagRows}</tbody>
</table>

<h2>🛒 Produtos Mais Vendidos</h2>
<table>
  <thead><tr><th>Produto</th><th>Qtd Vendida</th><th>Total Arrecadado</th></tr></thead>
  <tbody>${prodRows}</tbody>
</table>

<h2>📋 Pedidos do Dia</h2>
<table>
  <thead><tr><th>Nº</th><th>Cliente</th><th>Pagamento</th><th>Total</th><th>Hora</th><th>Status</th></tr></thead>
  <tbody>${pedRows}</tbody>
</table>

<div class="footer">Relatório gerado automaticamente pelo sistema · ME Restaurante e Lanchonete</div>
<script>window.onload = () => window.print();<\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
};

let carrinhoBalcao = [];
let consumoBalcaoSelecionado = 'aqui';

window.acessoBalcao = () => {
    document.getElementById('input-senha-balcao').value = '';
    abrirModal('modal-senha-balcao');
    setTimeout(() => document.getElementById('input-senha-balcao').focus(), 100);
};
document.getElementById('input-senha-balcao').addEventListener('keydown', e => { if(e.key === 'Enter') window.confirmarSenhaBalcao(); });

window.confirmarSenhaBalcao = () => {
    if (document.getElementById('input-senha-balcao').value === getSenha()) {
        fecharModal('modal-senha-balcao');
        irPara('tela-balcao');
        renderBalcaoCardapio();
        renderCarrinhoBalcao();
    } else {
        document.getElementById('input-senha-balcao').style.border = '2px solid red';
        setTimeout(() => document.getElementById('input-senha-balcao').style.border = '', 1500);
        alert('Senha incorreta!');
    }
};

window.selecionarConsumoBalcao = (tipo) => {
    consumoBalcaoSelecionado = tipo;
    document.getElementById('bp-opcao-aqui').classList.toggle('selecionado', tipo === 'aqui');
    document.getElementById('bp-opcao-levar').classList.toggle('selecionado', tipo === 'levar');
};

const renderBalcaoCardapio = window.renderBalcaoCardapio = () => {
    const busca = (document.getElementById('balcao-busca')?.value || '').toLowerCase().trim();
    const div = document.getElementById('balcao-lista-produtos');
    if (!div) return;
    div.innerHTML = '';
    const cats = [
        { id: 'food', nome: '🍛 Comidas' },
        { id: 'drinks', nome: '🥤 Bebidas' },
        { id: 'savory', nome: '🧆 Porções Salgadas' },
        { id: 'sweet', nome: '🍮 Porções Doces' },
        { id: 'snacks', nome: '🥪 Lanches' }
    ];
    cats.forEach(cat => {
        const filtrados = produtos.filter(p => p.cat === cat.id && (!busca || p.nome.toLowerCase().includes(busca)));
        if (!filtrados.length) return;
        div.innerHTML += `<div class="balcao-cat-titulo">${cat.nome}</div><div class="balcao-grid" id="bgrid-${cat.id}"></div>`;
        const grid = div.querySelector(`#bgrid-${cat.id}`);
        filtrados.forEach(p => {
            grid.innerHTML += `<div class="balcao-card">
                ${p.promo === 'sim' ? '<span class="badge-promo" style="font-size:0.62rem;padding:2px 8px;">🔥 Promo</span>' : ''}
                <img src="${p.foto || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop'}" alt="${p.nome}" loading="lazy">
                <div class="balcao-card-info">
                    <h4>${p.nome}</h4>
                    <div class="preco" style="font-size:1rem;">R$ ${p.preco.toFixed(2)}</div>
                    <button class="balcao-add-btn" onclick="addBalcao('${p.firestoreId}')">+ Adicionar</button>
                </div>
            </div>`;
        });
    });
    if (!div.innerHTML) div.innerHTML = '<p style="color:var(--muted);padding:20px;text-align:center;">Nenhum produto encontrado.</p>';
};

window.addBalcao = (fid) => {
    const p = produtos.find(x => x.firestoreId === fid);
    if (!p) return;
    document.getElementById('modal-bp-fid').value = fid;
    document.getElementById('modal-bp-titulo').innerText = p.nome;
    document.getElementById('modal-bp-preco').innerText = `R$ ${p.preco.toFixed(2)}`;
    document.getElementById('modal-bp-obs').value = '';
    consumoBalcaoSelecionado = 'aqui';
    document.getElementById('bp-opcao-aqui').classList.add('selecionado');
    document.getElementById('bp-opcao-levar').classList.remove('selecionado');
    abrirModal('modal-balcao-produto');
    setTimeout(() => document.getElementById('modal-bp-obs').focus(), 200);
};

window.confirmarAddBalcao = () => {
    const fid = document.getElementById('modal-bp-fid').value;
    const obs = document.getElementById('modal-bp-obs').value.trim();
    const p = produtos.find(x => x.firestoreId === fid);
    if (!p) return;
    carrinhoBalcao.push({ ...p, _uid: Date.now() + Math.random(), consumo: consumoBalcaoSelecionado, obs });
    fecharModal('modal-balcao-produto');
    renderCarrinhoBalcao();
    mostrarToast(`✅ ${p.nome} adicionado!`);
};

function renderCarrinhoBalcao() {
    const div = document.getElementById('balcao-itens-lista');
    if (!div) return;
    div.innerHTML = '';
    let total = 0;
    if (!carrinhoBalcao.length) {
        div.innerHTML = '<p style="color:var(--muted);text-align:center;padding:16px 0;font-size:0.9rem;">Nenhum item adicionado.</p>';
        document.getElementById('balcao-total').innerText = 'R$ 0,00';
        return;
    }
    carrinhoBalcao.forEach((item, i) => {
        total += item.preco;
        const consumoLabel = item.consumo === 'levar' ? '🥡 Para levar' : '🍽️ Aqui';
        div.innerHTML += `<div class="balcao-item">
            <div style="flex:1;">
                <div style="font-weight:700;font-size:0.9rem;">${item.nome}</div>
                <div style="font-size:0.75rem;color:var(--muted);">${consumoLabel}${item.obs ? ' · ' + item.obs : ''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;white-space:nowrap;">
                <span style="color:var(--success);font-weight:700;">R$ ${item.preco.toFixed(2)}</span>
                <button style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1.1rem;" onclick="removerItemBalcao(${i})">🗑</button>
            </div>
        </div>`;
    });
    document.getElementById('balcao-total').innerText = `R$ ${total.toFixed(2)}`;
}

window.removerItemBalcao = (i) => {
    carrinhoBalcao.splice(i, 1);
    renderCarrinhoBalcao();
};

window.limparCarrinhoBalcao = () => {
    if (carrinhoBalcao.length && !confirm('Limpar todos os itens?')) return;
    carrinhoBalcao = [];
    document.getElementById('balcao-cliente').value = '';
    document.getElementById('balcao-obs').value = '';
    document.getElementById('balcao-pagamento').selectedIndex = 0;
    renderCarrinhoBalcao();
};

window.finalizarPedidoBalcao = async () => {
    if (!carrinhoBalcao.length) return alert('Adicione itens ao pedido!');
    const nome = document.getElementById('balcao-cliente').value.trim() || 'Balcão';
    const pag = document.getElementById('balcao-pagamento').value;
    const obsGeral = document.getElementById('balcao-obs').value.trim();
    const total = carrinhoBalcao.reduce((a, p) => a + p.preco, 0);
    const num = pedidos.length + 1;
    const agora = new Date();
    const pedido = {
        id: num, cliente: nome, total,
        itens: carrinhoBalcao.map(i => ({ nome: i.nome, preco: i.preco, cat: i.cat || 'food', consumo: i.consumo || 'aqui', obs: i.obs || '' })),
        pagamento: pag, obsGeral: obsGeral,
        hora: agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        timestamp: agora.getTime(), status: 'pendente',
        origem: 'balcao'
    };

    let docRef;
    try {
        docRef = await addDoc(collection(db, 'pedidos'), pedido);
    } catch (e) {
        alert('Erro ao salvar pedido: ' + e.message);
        return;
    }

    pedidoBalcaoFid = docRef.id;
    pedidoBalcaoStatus = 'pendente';
    document.getElementById('balcao-notif-pronto').classList.remove('ativa');

    const itensHtml = pedido.itens.map(i => {
        const consumo = i.consumo === 'levar' ? '🥡 Para levar' : '🍽️ Aqui';
        return `<div class="com-item">
            <span>${i.nome}${i.obs ? ' <small style="color:#888">(' + i.obs + ')</small>' : ''}</span>
            <span style="white-space:nowrap;margin-left:8px;">${consumo} — R$ ${i.preco.toFixed(2)}</span>
        </div>`;
    }).join('');

    document.getElementById('comanda-conteudo').innerHTML = `
        <h2>ME Restaurante e Lanchonete</h2>
        <div style="text-align:center;"><span class="comanda-tag">🏪 VENDA EM BALCÃO</span></div>
        <hr class="com-divider">
        <div class="com-num">#${pedido.id}</div>
        <hr class="com-divider">
        <div class="com-item"><span><b>Cliente:</b></span><span>${pedido.cliente}</span></div>
        <div class="com-item"><span><b>Hora:</b></span><span>${pedido.hora}</span></div>
        <div class="com-item"><span><b>Pagamento:</b></span><span>${pedido.pagamento}</span></div>
        <hr class="com-divider">
        <div style="font-weight:700;margin-bottom:6px;font-size:0.85rem;">ITENS DO PEDIDO:</div>
        ${itensHtml}
        <hr class="com-divider">
        <div class="com-item" style="font-weight:900;font-size:1rem;"><span>TOTAL:</span><span>R$ ${pedido.total.toFixed(2)}</span></div>
        ${obsGeral ? `<hr class="com-divider"><div style="font-size:0.82rem;"><b>📋 Obs. Geral:</b> ${obsGeral}</div>` : ''}
        <hr class="com-divider">
        <div style="text-align:center;font-size:0.8rem;margin-top:6px;">✨ Obrigado! ✨</div>
    `;

    document.getElementById('modal-comanda').classList.add('ativa');
    tocarSom();

    carrinhoBalcao = [];
    document.getElementById('balcao-cliente').value = '';
    document.getElementById('balcao-obs').value = '';
    document.getElementById('balcao-pagamento').selectedIndex = 0;
    renderCarrinhoBalcao();
};

const fecharComanda = window.fecharComanda = () => {
    document.getElementById('modal-comanda').classList.remove('ativa');
};

document.getElementById('modal-comanda').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-comanda')) fecharComanda();
});
