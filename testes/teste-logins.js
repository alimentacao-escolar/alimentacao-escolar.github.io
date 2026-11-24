// teste-logins.js — Testes da geração automática de logins (NutriGestão)
// Rodar com: node testes/teste-logins.js
// Carrega os arquivos REAIS do projeto (js/auth.js, js/cadastro.js, js/excel-import.js)
// com stubs de navegador e de banco em memória — nenhum dado real é alterado.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const raiz = path.join(__dirname, "..");

// ---------------------------------------------------------------- stubs de navegador
global.window = { location: { href: "" } };
global.localStorage = {
  _dados: {},
  getItem(chave) {
    return Object.prototype.hasOwnProperty.call(this._dados, chave) ? this._dados[chave] : null;
  },
  setItem(chave, valor) {
    this._dados[chave] = String(valor);
  },
  removeItem(chave) {
    delete this._dados[chave];
  }
};

function novoElemento(id) {
  return {
    id,
    value: "",
    innerHTML: "",
    textContent: "",
    className: "",
    disabled: false,
    style: {},
    files: null,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    reset() {},
    focus() {}
  };
}
const elementos = {};
global.document = {
  getElementById(id) {
    if (!elementos[id]) elementos[id] = novoElemento(id);
    return elementos[id];
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
  createElement(tag) {
    return novoElemento(tag);
  },
  body: { prepend() {} }
};

// ---------------------------------------------------------------- banco em memória
let dbPessoas = [];
let dbUsuarios = [];
let seqId = 0;

const apenas = (obj, campos) => {
  const saida = {};
  campos.forEach((c) => {
    saida[c] = obj[c];
  });
  return saida;
};
const tabela = (nome) =>
  nome === "pessoas" ? dbPessoas : nome === "usuarios" ? dbUsuarios : null;

global.Database = {
  async getColecao(nome) {
    const t = tabela(nome);
    return t ? t.map((r) => ({ ...r })) : [];
  },
  async getDocumento(nome, id) {
    const t = tabela(nome);
    return t ? t.find((r) => r.id === id) || null : null;
  },
  async adicionar(nome, dados) {
    const t = tabela(nome);
    if (!t) throw new Error("tabela desconhecida: " + nome);
    const id = "id" + ++seqId;
    t.push({ id, ...dados });
    return id;
  },
  async adicionarLote(nome, registros) {
    const t = tabela(nome);
    if (!t) throw new Error("tabela desconhecida: " + nome);
    registros.forEach((r) => {
      t.push({ id: r.id || "id" + ++seqId, ...r });
    });
    return registros.length;
  },
  async listarCampos(nome, campos) {
    const t = tabela(nome);
    return t ? t.map((r) => apenas(r, campos)) : [];
  },
  async atualizar(nome, id, dados) {
    const t = tabela(nome);
    if (!t) throw new Error("tabela desconhecida: " + nome);
    const i = t.findIndex((r) => r.id === id);
    if (i < 0) throw new Error("Documento " + id + " não encontrado em " + nome);
    t[i] = { ...t[i], ...dados };
  },
  async excluir(nome, id) {
    const t = tabela(nome);
    if (!t) return;
    const i = t.findIndex((r) => r.id === id);
    if (i >= 0) t.splice(i, 1);
  },
  async excluirTodos(nome) {
    const t = tabela(nome);
    if (t) t.length = 0;
  },
  async buscarPorCampo(nome, campo, valor) {
    const t = tabela(nome);
    return t ? t.filter((r) => r[campo] === valor) : [];
  },
  async buscarPorOrdem() {
    return [];
  },
  mostrarErro(erro) {
    console.error("[stub-DB]", erro);
  },
  erroAmigavel(erro) {
    return String((erro && erro.message) || erro);
  }
};

// ---------------------------------------------------------------- carrega o código real
function carregar(rel) {
  const caminho = path.join(raiz, rel);
  vm.runInThisContext(fs.readFileSync(caminho, "utf8"), { filename: rel });
}
carregar("js/auth.js");
carregar("js/cadastro.js");
carregar("js/excel-import.js");

const Cadastro = vm.runInThisContext("Cadastro");
const ImportadorExcel = vm.runInThisContext("ImportadorExcel");
const Auth = vm.runInThisContext("Auth");

// ---------------------------------------------------------------- runner
let total = 0;
let falhas = 0;

async function teste(nome, fn) {
  total++;
  try {
    await fn();
    console.log("  ok  " + nome);
  } catch (erro) {
    falhas++;
    console.log("  FALHOU  " + nome);
    console.log("       " + (erro && erro.message));
  }
}

function resetarBanco(pessoas = [], usuarios = []) {
  dbPessoas = pessoas.map((p) => ({ ...p }));
  dbUsuarios = usuarios.map((u) => ({ ...u }));
}

function preencherFormulario({ nome, categoria = "aluno", dataNascimento = "", turmaSetor = "" }) {
  document.getElementById("nome").value = nome;
  document.getElementById("categoria").value = categoria;
  document.getElementById("dataNascimento").value = dataNascimento;
  document.getElementById("turmaSetor").value = turmaSetor;
}

async function main() {
  console.log("\n=== 1. Regra de geração (_gerarLogin) — exemplos obrigatórios ===");

  const exemplos = [
    // novos exemplos da regra (mensagem de correção em massa)
    ["ISMAEL DOS SANTOS RANIERI", "ismaelsantos"],
    ["RIAN DA SILVA SOUTO", "riansilva"],
    ["SARAH DOS SANTOS MACIEL", "sarahsantos"],
    ["MARIA DA SILVA", "mariasilva"],
    ["JOSÉ DOS SANTOS", "josesantos"],
    ["DAVIDSON OLIVEIRA DOS SANTOS", "davidsonoliveira"],
    ["LUIZ LEVY SANTOS DA SILVA", "luizlevy"],
    // exemplos antigos
    ["João Pedro de Souza", "joaopedro"],
    ["Ana Clara dos Santos", "anaclara"],
    ["Lucas Ferreira", "lucasferreira"],
    ["Pedro Henrique da Costa", "pedrohenrique"],
    // atenção: sob a regra atual (primeira palavra não-conectivo) este exemplo
    // antigo passa a ser mariafatima — divergência documentada no relatório
    ["Maria de Fátima Silva", "mariafatima"]
  ];
  for (const [nome, esperado] of exemplos) {
    await teste(`"${nome}" -> ${esperado}`, () => {
      assert.strictEqual(Cadastro._gerarLogin(nome), esperado);
    });
  }

  console.log("\n=== 2. Acentos, caracteres especiais, espaços e caixa ===");
  const especiais = [
    ["José da Conceição", "joseconceicao"],
    ["María José Álvarez", "mariajose"],
    ["João-Pedro Alves", "joaopedro"],
    ["  Ana   Clara  ", "anaclara"],
    ["Maria Silva!", "mariasilva"],
    ["Ângelo de Souza", "angelosouza"],
    ["Madonna", "madonna"],
    ["", ""],
    ["   ", ""]
  ];
  for (const [nome, esperado] of especiais) {
    await teste(`"${nome}" -> ${esperado || "(vazio)"}`, () => {
      assert.strictEqual(Cadastro._gerarLogin(nome), esperado);
    });
  }

  console.log("\n=== 3. Verificação de duplicatas (_loginUnico) ===");

  await teste("duplicata simples: joaosilva -> joaosilva2 -> joaosilva3", async () => {
    resetarBanco([
      { id: "p1", nome: "João Silva", login: "joaosilva" },
      { id: "p2", nome: "João Silva", login: "joaosilva2" }
    ]);
    const base = Cadastro._gerarLogin("João Silva");
    assert.strictEqual(base, "joaosilva");
    assert.strictEqual(await Cadastro._loginUnico(base), "joaosilva3");
  });

  await teste("duplicidade ignora maiúsculas/minúsculas (existe 'JoaoSilva')", async () => {
    resetarBanco([{ id: "p1", nome: "João Silva", login: "JoaoSilva" }]);
    const l = await Cadastro._loginUnico(Cadastro._gerarLogin("João Silva"));
    assert.strictEqual(l, "joaosilva2");
  });

  await teste("edição não colide consigo mesma (excetoId)", async () => {
    resetarBanco([{ id: "p1", nome: "João Silva", login: "joaosilva" }]);
    const l = await Cadastro._loginUnico("joaosilva", "p1");
    assert.strictEqual(l, "joaosilva");
  });

  await teste("bloqueia login que já existe na coleção 'usuarios'", async () => {
    resetarBanco([], [{ id: "u1", usuario: "mariasilva" }]);
    const l = await Cadastro._loginUnico("mariasilva");
    assert.strictEqual(l, "mariasilva2");
  });

  console.log("\n=== 4. Cadastro manual (salvar) ===");

  await teste("criação: 'José dos Santos' recebe josesantos e senha do nascimento", async () => {
    resetarBanco();
    Cadastro.editandoId = null;
    preencherFormulario({ nome: "José dos Santos", dataNascimento: "2010-03-15" });
    await Cadastro.salvar();
    assert.strictEqual(dbPessoas.length, 1);
    assert.strictEqual(dbPessoas[0].login, "josesantos");
    assert.strictEqual(dbPessoas[0].senha, "15032010");
    assert.ok(dbPessoas[0].matricula, "matrícula deve ser gerada");
  });

  await teste("criação duplicada: duas 'João Silva' distintas recebem joaosilva e joaosilva2", async () => {
    resetarBanco();
    Cadastro.editandoId = null;
    preencherFormulario({ nome: "João Silva", dataNascimento: "2010-01-01" });
    await Cadastro.salvar();
    Cadastro.editandoId = null;
    preencherFormulario({ nome: "João Silva", dataNascimento: "2011-02-02" });
    await Cadastro.salvar();
    assert.strictEqual(dbPessoas.length, 2);
    assert.strictEqual(dbPessoas[0].login, "joaosilva");
    assert.strictEqual(dbPessoas[1].login, "joaosilva2");
    assert.notStrictEqual(dbPessoas[0].senha, dbPessoas[1].senha);
  });

  await teste("edição sem mudar o nome preserva o login antigo e a senha", async () => {
    resetarBanco([
      {
        id: "p1",
        nome: "Maria Silva",
        login: "MariaSilva", // formato antigo (usuário já cadastrado)
        senha: "15032010",
        categoria: "aluno",
        turmaSetor: "2A",
        matricula: "2026001"
      }
    ]);
    Cadastro.editandoId = "p1";
    preencherFormulario({ nome: "Maria Silva", dataNascimento: "", turmaSetor: "3B" });
    await Cadastro.salvar();
    assert.strictEqual(dbPessoas[0].login, "MariaSilva", "login não pode ser reescrito");
    assert.strictEqual(dbPessoas[0].senha, "15032010", "senha não pode ser alterada");
    assert.strictEqual(dbPessoas[0].turmaSetor, "3B", "os outros dados devem ser atualizados");
  });

  await teste("edição com nome alterado regenera o login pela nova regra", async () => {
    resetarBanco([
      {
        id: "p1",
        nome: "João Silva",
        login: "joaosilva",
        senha: "01012010",
        categoria: "aluno",
        turmaSetor: "2A",
        matricula: "2026002"
      }
    ]);
    Cadastro.editandoId = "p1";
    preencherFormulario({ nome: "João Pedro Souza", dataNascimento: "", turmaSetor: "2A" });
    await Cadastro.salvar();
    assert.strictEqual(dbPessoas[0].login, "joaopedro");
    assert.strictEqual(dbPessoas[0].senha, "01012010", "senha preservada");
    assert.strictEqual(dbPessoas[0].nome, "João Pedro Souza");
  });

  await teste("edição de pessoa sem login preenche o login pela primeira vez", async () => {
    resetarBanco([
      {
        id: "p1",
        nome: "Ana Clara",
        login: null,
        senha: "05052010",
        categoria: "aluno",
        turmaSetor: "1A",
        matricula: "2026003"
      }
    ]);
    Cadastro.editandoId = "p1";
    preencherFormulario({ nome: "Ana Clara", dataNascimento: "", turmaSetor: "1A" });
    await Cadastro.salvar();
    assert.strictEqual(dbPessoas[0].login, "anaclara");
    assert.strictEqual(dbPessoas[0].senha, "05052010");
  });

  console.log("\n=== 5. Importação de planilha Excel ===");

  await teste("gera logins pela nova regra e deduplica na planilha e no banco", async () => {
    resetarBanco([
      {
        id: "px",
        nome: "Maria Silva",
        login: "MariaSilva", // existente no banco (formato antigo)
        senha: "01012009",
        categoria: "aluno",
        turmaSetor: "1A",
        matricula: "2026000",
        dataNascimento: "2009-01-01"
      }
    ]);

    const linha = (nome, nasc, num) =>
      ImportadorExcel.validarLinha(
        { nome, categoria: "aluno", dataNascimento: nasc, turmaSetor: "2B" },
        num
      );

    ImportadorExcel.linhas = [
      linha("José dos Santos", "15/03/2010", 2),
      linha("José dos Santos", "16/04/2011", 3), // outra pessoa com o mesmo nome
      linha("Maria da Silva", "10/05/2012", 4), // colide com "MariaSilva" existente
      linha("João Silva", "01/01/2010", 5),
      linha("João Silva", "02/02/2010", 6), // duplicado na própria planilha
      linha("Pedro Henrique da Costa", "03/03/2010", 7)
    ];

    // preview já mostra a base correta
    assert.strictEqual(ImportadorExcel.linhas[0].login, "josesantos");
    assert.strictEqual(ImportadorExcel.linhas[3].login, "joaosilva");

    await ImportadorExcel.confirmarImportacao();

    const logins = ImportadorExcel.linhas.map((l) => l.login);
    assert.deepStrictEqual(logins, [
      "josesantos",
      "josesantos2",
      "mariasilva2",
      "joaosilva",
      "joaosilva2",
      "pedrohenrique"
    ]);
    ImportadorExcel.linhas.forEach((l) => {
      assert.strictEqual(l.ok, true, "linha deveria estar ok: " + l.nome + " -> " + l.erro);
      assert.strictEqual(l.importada, true, "linha deveria ter sido importada: " + l.nome);
    });
    assert.strictEqual(dbPessoas.length, 7, "1 existente + 6 importadas");
    const loginsNoBanco = dbPessoas.map((p) => String(p.login || "").toLowerCase());
    assert.strictEqual(new Set(loginsNoBanco).size, loginsNoBanco.length, "sem logins duplicados no banco");
    ImportadorExcel.linhas.forEach((l) => {
      assert.ok(l.senha && l.senha.length >= 6, "senha derivada do nascimento");
    });
  });

  await teste("reimportar a mesma planilha não gera logins novos (pessoas já cadastradas)", async () => {
    const antes = dbPessoas.map((p) => ({ ...p }));
    ImportadorExcel.linhas = [
      ImportadorExcel.validarLinha(
        { nome: "José dos Santos", categoria: "aluno", dataNascimento: "15/03/2010", turmaSetor: "2B" },
        2
      )
    ];
    await ImportadorExcel.confirmarImportacao();
    assert.strictEqual(dbPessoas.length, antes.length, "não deve cadastrar de novo");
    assert.strictEqual(ImportadorExcel.linhas[0].importada, false);
    assert.ok(/Já cadastrado/.test(ImportadorExcel.linhas[0].erro));
  });

  console.log("\n=== 6. Autenticação continua funcionando ===");

  await teste("login novo (minúsculo) autentica", async () => {
    resetarBanco([
      { id: "p1", nome: "Maria Silva", login: "mariasilva", senha: "15032010", categoria: "aluno" }
    ]);
    const u = await Auth.login("mariasilva", "15032010");
    assert.strictEqual(u.id, "p1");
    assert.strictEqual(u.perfil, "aluno");
    assert.strictEqual(u.origem, "pessoas");
  });

  await teste("login antigo (formato 'MariaSilva') continua autenticando", async () => {
    resetarBanco([
      { id: "p2", nome: "Maria Silva", login: "MariaSilva", senha: "15032010", categoria: "professor" }
    ]);
    const u = await Auth.login("MariaSilva", "15032010");
    assert.strictEqual(u.id, "p2");
    assert.strictEqual(u.perfil, "professor");
  });

  await teste("matrícula continua funcionando como login alternativo", async () => {
    resetarBanco([
      {
        id: "p3",
        nome: "Zé Teste",
        login: "zeteste",
        matricula: "2026099",
        senha: "01012010",
        categoria: "funcionario"
      }
    ]);
    const u = await Auth.login("2026099", "01012010");
    assert.strictEqual(u.id, "p3");
    assert.strictEqual(u.perfil, "funcionario");
  });

  await teste("senha errada é recusada", async () => {
    resetarBanco([
      { id: "p1", nome: "Maria Silva", login: "mariasilva", senha: "15032010", categoria: "aluno" }
    ]);
    await assert.rejects(() => Auth.login("mariasilva", "senhaErrada"), /inválidos/);
  });

  await teste("login repetido autentica na pessoa certa pela senha", async () => {
    resetarBanco([
      { id: "p1", nome: "Maria Eduarda Cruz", login: "mariaeduarda", senha: "01022011", categoria: "aluno" },
      { id: "p2", nome: "Maria Eduarda Silva", login: "mariaeduarda", senha: "26082010", categoria: "aluno" },
      { id: "p3", nome: "Maria Eduarda Costa", login: "mariaeduarda", senha: "10102010", categoria: "aluno" }
    ]);
    const u1 = await Auth.login("mariaeduarda", "26082010");
    assert.strictEqual(u1.id, "p2", "senha da 2ª pessoa deve cair na conta dela");
    const u2 = await Auth.login("mariaeduarda", "10102010");
    assert.strictEqual(u2.id, "p3", "senha da 3ª pessoa deve cair na conta dela");
    const u3 = await Auth.login("mariaeduarda", "01022011");
    assert.strictEqual(u3.id, "p1", "senha da 1ª pessoa deve cair na conta dela");
    await assert.rejects(() => Auth.login("mariaeduarda", "senhaErrada"), /inválidos/);
  });

  await teste("conta da coleção 'usuarios' (criada pelo admin) autentica", async () => {
    resetarBanco([], [
      { id: "u1", usuario: "coordenador", senha: "abc123", nome: "Coordenador", perfil: "gestao" }
    ]);
    const u = await Auth.login("coordenador", "abc123");
    assert.strictEqual(u.origem, "usuarios");
    assert.strictEqual(u.perfil, "gestao");
  });

  await teste("contas fixas admin/admin e Gestao continuam valendo", async () => {
    resetarBanco();
    const a = await Auth.login("admin", "admin");
    assert.strictEqual(a.perfil, "admin");
    const g = await Auth.login("Gestao", "Diretoria@2026");
    assert.strictEqual(g.perfil, "gestao");
  });

  // ---------------------------------------------------------------- resultado
  console.log("\n----------------------------------------");
  console.log("Total: " + total + " · Passaram: " + (total - falhas) + " · Falharam: " + falhas);
  if (falhas > 0) console.log("Há testes falhando.");
  else console.log("Todos os testes passaram.");
  // exit() evita que os timers dos alertas (setTimeout) mantenham o processo vivo
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch((erro) => {
  console.error("Erro inesperado nos testes:", erro);
  process.exit(1);
});
