// corrigir-logins.js — Procedimento de correção em massa dos logins (NutriGestão)
//
// Uso:
//   node testes/corrigir-logins.js             → analisa TUDO, mostra a lista (nome, login atual,
//                                                 novo login), aponta conflitos e grava backup.
//                                                 NÃO altera nenhum dado.
//   node testes/corrigir-logins.js --aplicar   → grava backup NOVAMENTE (estado atual) e só então
//                                                 aplica as correções planejadas.
//
// Regra (função central Cadastro._gerarLogin — js/cadastro.js, a mesma usada no cadastro manual
// e na importação de planilhas):
//   primeiro nome + primeiro sobrenome válido, ignorando conectivos (de, da, do, das, dos, e),
//   sem acentos, sem espaços, sem caracteres especiais, tudo em minúsculas.
//   Ex.: ISMAEL DOS SANTOS RANIERI → ismaelsantos · LUIZ LEVY SANTOS DA SILVA → luizlevy
//
// O que é alterado (e apenas isso):
//   • campo "login" da tabela "pessoas";
//   • quando uma conta da tabela "usuarios" está ESPPELHADA (pessoaId vinculado + usuario igual
//     ao login antigo da pessoa), o "usuario" dela acompanha a mudança.
// Nada mais é tocado: senhas, matrículas, nomes, registros de presença/refeições e demais campos
// permanecem intactos. Nenhum usuário é excluído.
//
// Duplicidades são resolvidas acrescentando 2, 3... ao final do login.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const APLICAR = process.argv.includes("--aplicar");

// ------------------------------------------------------------------ conexão
const cfg = fs.readFileSync(path.join(raiz, "js", "supabase-config.js"), "utf8");
const SUPABASE_URL = (cfg.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const SUPABASE_KEY = (cfg.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/) || [])[1];
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Não foi possível ler SUPABASE_URL/SUPABASE_KEY em js/supabase-config.js");
  process.exit(1);
}
const REST = SUPABASE_URL + "/rest/v1";
const cabecalhos = (extra) =>
  Object.assign({ apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY }, extra || {});

async function rest(caminho, opcoes) {
  const o = opcoes || {};
  const headers = cabecalhos(o.corpo !== undefined ? { "Content-Type": "application/json" } : null);
  const resposta = await fetch(REST + caminho, {
    method: o.metodo || "GET",
    headers,
    body: o.corpo !== undefined ? JSON.stringify(o.corpo) : undefined
  });
  if (!resposta.ok) {
    throw new Error("HTTP " + resposta.status + " em " + (o.metodo || "GET") + " " + caminho + ": " + (await resposta.text()));
  }
  if (resposta.status === 204) return null;
  const texto = await resposta.text();
  return texto ? JSON.parse(texto) : null;
}

async function buscarTudo(tabela, campos) {
  const todos = [];
  let offset = 0;
  for (;;) {
    const linhas = await rest("/" + tabela + "?select=" + campos.join(",") + "&limit=1000&offset=" + offset);
    todos.push.apply(todos, linhas);
    if (linhas.length < 1000) break;
    offset += 1000;
  }
  return todos;
}

async function contarTotal(tabela) {
  const resposta = await fetch(REST + "/" + tabela + "?select=id&limit=1", {
    headers: cabecalhos({ Prefer: "count=exact" })
  });
  if (!resposta.ok) throw new Error("Falha ao contar " + tabela + ": HTTP " + resposta.status);
  const faixa = resposta.headers.get("content-range"); // "0-0/123"
  return faixa && faixa.includes("/") ? Number(faixa.split("/")[1]) : null;
}

// ------------------------------------------------- função central de login
global.Auth = { verificarAcesso: () => false }; // impede o auto-load da tela do cadastro
vm.runInThisContext(fs.readFileSync(path.join(raiz, "js", "cadastro.js"), "utf8"), {
  filename: "js/cadastro.js"
});
const Cadastro = vm.runInThisContext("Cadastro");

// Regra histórica (pular "conectivo + palavra"), usada só para sinalizar nomes em que as duas
// regras dariam resultados diferentes — informativo para quem revisa a lista.
function regraHistorica(nome) {
  const conectivos = ["de", "da", "do", "das", "dos", "e"];
  const partes = String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length === 0) return "";
  let sobrenome = "";
  for (let i = 1; i < partes.length; i++) {
    if (conectivos.includes(partes[i])) {
      i++;
      continue;
    }
    sobrenome = partes[i];
    break;
  }
  if (!sobrenome) sobrenome = partes.slice(1).find((p) => !conectivos.includes(p)) || "";
  return (partes[0] + sobrenome).replace(/[^a-z0-9]/g, "");
}

// ------------------------------------------------------------------ plano
function calcularPlano(pessoas, usuarios) {
  const linhas = pessoas.map((p) => {
    const nome = String(p.nome || "");
    const desejado = Cadastro._gerarLogin(nome) || "usuario";
    return {
      id: p.id,
      nome: nome || "(sem nome)",
      matricula: p.matricula || "",
      categoria: p.categoria || "",
      loginAtual: p.login == null ? "" : String(p.login),
      desejado,
      loginNovo: "",
      alterar: false,
      conflito: false,
      nota: ""
    };
  });

  // 1) quem já está certo fica; duplicidade entre "certos" vira conflito
  const reservado = new Set();
  const mudancas = [];
  const manter = [];
  for (const l of linhas) {
    const chave = l.loginAtual.toLowerCase();
    if (l.loginAtual && l.loginAtual === l.desejado) {
      if (reservado.has(chave)) {
        l.nota = "duplicidade existente no banco (mesmo login de outra pessoa)";
        mudancas.push(l);
      } else {
        reservado.add(chave);
        manter.push(l);
      }
    } else {
      if (!l.loginAtual) l.nota = "sem login cadastrado";
      mudancas.push(l);
    }
  }

  // 2) contas da tabela "usuarios" que espelham o login de uma pessoa que vai mudar
  const idsMudando = new Set(mudancas.map((m) => m.id));
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const espelhos = [];
  const usuariosSemEspelho = [];
  for (const u of usuarios) {
    const pessoa = u.pessoaId ? porId.get(u.pessoaId) : null;
    if (pessoa && idsMudando.has(u.pessoaId) && String(u.usuario || "") === pessoa.loginAtual) {
      espelhos.push({
        id: u.id,
        usuarioAtual: String(u.usuario),
        usuarioNovo: null,
        pessoaId: u.pessoaId,
        nomePessoa: pessoa.nome
      });
    } else {
      usuariosSemEspelho.push(u);
    }
  }

  // reserva: logins mantidos + usuarios que NÃO serão renomeados
  for (const u of usuariosSemEspelho) {
    const v = String(u.usuario || "").toLowerCase();
    if (v) reservado.add(v);
  }

  // 3) atribui os logins novos (2, 3... quando ocupado)
  for (const l of mudancas) {
    let candidato = l.desejado;
    let n = 2;
    while (reservado.has(candidato.toLowerCase())) {
      candidato = l.desejado + n;
      n++;
    }
    reservado.add(candidato.toLowerCase());
    l.loginNovo = candidato;
    l.alterar = candidato !== l.loginAtual;
    l.conflito = candidato !== l.desejado;
    if (l.conflito && !/duplicidade/.test(l.nota)) l.nota = "desejado já ocupado → sufixo numérico";
    if (!l.alterar && l.conflito) l.nota = "mantém o login atual (conflito resolvido)";
  }

  // 4) espelhos acompanham o novo login da pessoa (se não colidir com outra conta)
  const valoresUsuarios = new Set(
    usuarios
      .filter((u) => !espelhos.some((e) => e.id === u.id))
      .map((u) => String(u.usuario || "").toLowerCase())
  );
  const espelhosAtivos = [];
  const espelhosIgnorados = [];
  for (const e of espelhos) {
    const pessoa = mudancas.find((m) => m.id === e.pessoaId);
    const novo = pessoa ? pessoa.loginNovo : null;
    const chave = novo ? novo.toLowerCase() : "";
    if (!novo || valoresUsuarios.has(chave)) {
      espelhosIgnorados.push(Object.assign({}, e, { motivo: novo ? "colisão com outro usuário da tabela" : "pessoa sem novo login" }));
    } else {
      valoresUsuarios.add(chave);
      espelhosAtivos.push(Object.assign({}, e, { usuarioNovo: novo }));
    }
  }

  // 5) duplicidades pré-existentes (dois ou mais pessoas com o mesmo login hoje)
  const porLogin = new Map();
  for (const l of linhas) {
    if (!l.loginAtual) continue;
    const chave = l.loginAtual.toLowerCase();
    if (!porLogin.has(chave)) porLogin.set(chave, []);
    porLogin.get(chave).push(l);
  }
  const duplicidadesPreexistentes = [...porLogin.entries()]
    .filter(([, grupos]) => grupos.length > 1)
    .map(([chave, grupos]) => ({ login: chave, pessoas: grupos.map((g) => g.nome + " (mat. " + (g.matricula || "-") + ")") }));

  // 6) nomes em que a regra histórica daria outro resultado (informativo)
  const divergentes = linhas
    .filter((l) => regraHistorica(l.nome) !== Cadastro._gerarLogin(l.nome))
    .map((l) => ({ nome: l.nome, atual: l.loginAtual, novo: l.loginNovo, regraAntiga: regraHistorica(l.nome) }));

  return { linhas, manter, mudancas, espelhosAtivos, espelhosIgnorados, duplicidadesPreexistentes, divergentes };
}

// ------------------------------------------------------------------ backup
function gravarBackup(conteudo) {
  const dir = path.join(raiz, "backup");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const carimbo = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const arquivo = path.join(dir, "logins-backup-" + carimbo + ".json");
  fs.writeFileSync(arquivo, JSON.stringify(conteudo, null, 2), "utf8");
  return arquivo;
}

// ------------------------------------------------------------------ relatório
function imprimirPlano(plano) {
  const { linhas, mudancas, manter, espelhosAtivos, espelhosIgnorados, duplicidadesPreexistentes, divergentes } = plano;

  console.log("\n===================== PREVIEW DA CORREÇÃO =====================");
  console.log("Pessoas analisadas ......... " + linhas.length);
  console.log("Já estão corretas (OK) ..... " + manter.length);
  console.log("Precisam de correção ....... " + mudancas.filter((m) => m.alterar).length);
  console.log("Conflitos resolvidos c/ nº . " + mudancas.filter((m) => m.alterar && m.conflito).length);
  console.log("Sem login cadastrado ....... " + mudancas.filter((m) => !m.loginAtual).length);
  console.log("Contas 'usuarios' espelhadas que acompanham: " + espelhosAtivos.length);
  if (espelhosIgnorados.length) console.log("Espelhos NÃO renomeados ..... " + espelhosIgnorados.length + " (ver detalhe no JSON)");

  console.log("\n--- Lista completa: nome | login atual → novo login | situação ---");
  for (const l of linhas) {
    const situacao = !l.alterar
      ? "OK (mantém)"
      : l.conflito
        ? "CORRIGIR c/ nº"
        : "CORRIGIR";
    const seta = l.alterar ? l.loginAtual + " → " + l.loginNovo : (l.loginAtual || "(vazio)");
    console.log(
      "  " + l.nome.padEnd(42).slice(0, 42) + " | " +
      (l.loginAtual || "(vazio)").padEnd(24).slice(0, 24) + " → " +
      (l.alterar ? l.loginNovo : (l.loginAtual || "-")).padEnd(24).slice(0, 24) + " | " +
      situacao + (l.nota && l.alterar ? "  [" + l.nota + "]" : "")
    );
  }

  if (duplicidadesPreexistentes.length) {
    console.log("\n--- CONFLITOS PRÉ-EXISTENTES (mesmo login hoje, pessoas diferentes) ---");
    for (const d of duplicidadesPreexistentes) {
      console.log("  " + d.login + " → " + d.pessoas.join(" · "));
    }
  } else {
    console.log("\nNenhuma duplicidade pré-existente de login encontrada.");
  }

  if (espelhosAtivos.length) {
    console.log("\n--- Contas da tabela 'usuarios' que acompanharão a mudança ---");
    for (const e of espelhosAtivos) {
      console.log("  " + e.nomePessoa + ": " + e.usuarioAtual + " → " + e.usuarioNovo);
    }
  }
  if (espelhosIgnorados.length) {
    console.log("\n--- Espelhos que NÃO serão alterados ---");
    for (const e of espelhosIgnorados) {
      console.log("  " + e.nomePessoa + " (" + e.usuarioAtual + "): " + e.motivo);
    }
  }

  if (divergentes.length) {
    console.log("\n--- INFORMATIVO: nomes em que a regra histórica daria outro login ---");
    for (const d of divergentes) {
      console.log("  " + d.nome + " → regra atual: " + (d.novo || d.atual || "-") + " | regra histórica: " + d.regraAntiga);
    }
  }
}

// ------------------------------------------------------------------ aplicar
async function aplicar(plano) {
  const alteracoes = plano.mudancas.filter((m) => m.alterar);
  console.log("\nAplicando " + alteracoes.length + " alteração(ões) de login em 'pessoas'...");
  let feitas = 0;
  for (const l of alteracoes) {
    await rest("/pessoas?id=eq." + encodeURIComponent(l.id), { metodo: "PATCH", corpo: { login: l.loginNovo } });
    feitas++;
    if (feitas % 25 === 0 || feitas === alteracoes.length) console.log("  " + feitas + "/" + alteracoes.length);
  }
  for (const e of plano.espelhosAtivos) {
    await rest("/usuarios?id=eq." + encodeURIComponent(e.id), { metodo: "PATCH", corpo: { usuario: e.usuarioNovo } });
    console.log("  espelho 'usuarios': " + e.usuarioAtual + " → " + e.usuarioNovo);
  }
}

async function verificar(plano) {
  const pessoas = await buscarTudo("pessoas", ["id", "nome", "login", "matricula"]);
  const usuarios = await buscarTudo("usuarios", ["id", "usuario", "pessoaId"]);
  const totalPessoas = await contarTotal("pessoas");
  const totalRegistros = await contarTotal("registros");
  const totalUsuarios = await contarTotal("usuarios");

  const problemas = [];
  const vistos = new Set();
  for (const p of pessoas) {
    const desejado = Cadastro._gerarLogin(String(p.nome || "")) || "usuario";
    const login = String(p.login || "");
    const aceitavel = login === desejado || new RegExp("^" + desejado + "\\d+$").test(login);
    if (!aceitavel) problemas.push("login fora da regra: " + (p.nome || "?") + " → " + (login || "(vazio)"));
    const chave = login.toLowerCase();
    if (vistos.has(chave)) problemas.push("login duplicado após correção: " + login);
    vistos.add(chave);
  }

  console.log("\n===================== VERIFICAÇÃO PÓS-APLICAÇÃO =====================");
  console.log("Pessoas no banco ........... " + totalPessoas + " (era " + plano.linhas.length + ")");
  console.log("Registros de presença ...... " + totalRegistros + " (não devem mudar)");
  console.log("Contas 'usuarios' .......... " + totalUsuarios + " (não devem mudar)");
  console.log("Logins fora da regra ....... " + problemas.filter((p) => p.startsWith("login fora")).length);
  console.log("Logins duplicados .......... " + problemas.filter((p) => p.startsWith("login duplicado")).length);
  if (problemas.length) {
    console.log("\nPROBLEMAS:");
    problemas.forEach((p) => console.log("  - " + p));
    return false;
  }
  console.log("\nTudo consistente: todos os logins seguem a regra e não há duplicidades.");
  return true;
}

// ------------------------------------------------------------------ main
async function main() {
  console.log("Modo: " + (APLICAR ? "APLICAR (com backup prévio)" : "ANÁLISE (somente leitura, nada é alterado)"));

  const pessoas = await buscarTudo("pessoas", ["id", "nome", "login", "matricula", "categoria"]);
  const usuarios = await buscarTudo("usuarios", ["id", "usuario", "pessoaId", "nome", "perfil"]);
  const totalRegistrosAntes = await contarTotal("registros");

  const plano = calcularPlano(pessoas, usuarios);
  imprimirPlano(plano);

  const backup = gravarBackup({
    geradoEm: new Date().toISOString(),
    supabase: SUPABASE_URL,
    modo: APLICAR ? "pré-aplicação" : "análise",
    regra: "primeiro nome + primeiro sobrenome (conectivos de/da/do/das/dos/e ignorados), minúsculas, sem acentos/espaços",
    contagens: { pessoas: pessoas.length, usuarios: usuarios.length, registros: totalRegistrosAntes },
    senhas: "NÃO incluídas neste backup (nunca são alteradas pelo procedimento)",
    snapshotPessoas: pessoas,
    snapshotUsuarios: usuarios,
    previa: plano.linhas.map((l) => ({
      nome: l.nome,
      loginAtual: l.loginAtual,
      loginNovo: l.alterar ? l.loginNovo : l.loginAtual,
      alterar: l.alterar,
      conflito: l.conflito,
      nota: l.nota
    })),
    alteracoes: plano.mudancas
      .filter((m) => m.alterar)
      .map((m) => ({ id: m.id, nome: m.nome, loginAntigo: m.loginAtual, loginNovo: m.loginNovo })),
    espelhosUsuarios: plano.espelhosAtivos,
    duplicidadesPreexistentes: plano.duplicidadesPreexistentes
  });
  console.log("\nBackup gravado em: " + path.relative(raiz, backup));

  if (!APLICAR) {
    console.log("\nNENHUM DADO FOI ALTERADO.");
    console.log("Para efetivar as correções acima, rode:");
    console.log("  node testes/corrigir-logins.js --aplicar");
    return;
  }

  await aplicar(plano);
  const ok = await verificar(plano);
  const corrigidos = plano.mudancas.filter((m) => m.alterar).length;
  const mantidos = plano.linhas.length - corrigidos;
  console.log("\n===================== RESUMO FINAL =====================");
  console.log("Logins corrigidos .......... " + corrigidos);
  console.log("Sem necessidade de alteração  " + mantidos);
  console.log("Conflitos resolvidos c/ nº .. " + plano.mudancas.filter((m) => m.alterar && m.conflito).length);
  console.log("Espelhos 'usuarios' atualizados " + plano.espelhosAtivos.length);
  console.log("Backup do estado anterior ... " + path.relative(raiz, backup));
  if (!ok) process.exitCode = 1;
}

main().catch((erro) => {
  console.error("\nERRO: " + (erro && erro.message ? erro.message : erro));
  process.exit(1);
});
