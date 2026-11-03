// cadastro.js — Logica do Cadastro de Pessoas

const Cadastro = {
  editandoId: null,

  async carregar() {
    try {
      const pessoas = await Database.getColecao("pessoas");
      this._renderizarTabela(pessoas);
    } catch (erro) {
      Database.mostrarErro(erro);
      document.getElementById("tabela-pessoas").innerHTML =
        "<p style='color:#c0392b;'>Não foi possível carregar as pessoas. Veja o aviso acima.</p>";
      return;
    }

    const busca = document.getElementById("busca-pessoas");
    busca.addEventListener("input", async () => {
      const filtro = busca.value.toLowerCase();
      const todas = await Database.getColecao("pessoas");
      const filtradas = todas.filter(
        (p) =>
          p.nome.toLowerCase().includes(filtro) ||
          String(p.login || "").toLowerCase().includes(filtro) ||
          String(p.matricula || "").includes(filtro) ||
          p.categoria.toLowerCase().includes(filtro)
      );
      this._renderizarTabela(filtradas);
    });

    document.getElementById("form-cadastro").addEventListener("submit", (e) => {
      e.preventDefault();
      this.salvar();
    });
  },

  async salvar() {
    const nome = document.getElementById("nome").value.trim();
    const categoria = document.getElementById("categoria").value;
    const dataNascimento = document.getElementById("dataNascimento").value;
    const turmaSetor = document.getElementById("turmaSetor").value.trim();

    if (!nome || !categoria) {
      this._mostrarAlerta("Preencha o nome e a categoria.", "erro");
      return;
    }

    if (!this.editandoId && !dataNascimento) {
      this._mostrarAlerta("Informe a data de nascimento (será a senha).", "erro");
      return;
    }

    const hoje = new Date().toISOString().split("T")[0];
    if (dataNascimento && dataNascimento > hoje) {
      this._mostrarAlerta("A data de nascimento não pode ser no futuro.", "erro");
      return;
    }

    const dados = { nome, categoria, turmaSetor };
    if (dataNascimento) {
      dados.dataNascimento = dataNascimento;
      dados.senha = this._nascimentoParaSenha(dataNascimento);
    }

    try {
      if (this.editandoId) {
        const atual = await Database.getDocumento("pessoas", this.editandoId);
        const loginNovo = this._gerarLogin(nome);
        // Regenera o login só se ainda não existir ou se o nome mudou (preserva logins já cadastrados)
        if (!atual.login || (atual.nome !== nome && atual.login !== loginNovo)) {
          dados.login = await this._loginUnico(loginNovo, this.editandoId);
        }
        await Database.atualizar("pessoas", this.editandoId, dados);
        const loginFinal = dados.login || (atual && atual.login) || "";
        this._mostrarAlerta(
          loginFinal ? "Pessoa atualizada! Login: " + loginFinal : "Pessoa atualizada com sucesso!",
          "sucesso"
        );
      } else {
        const matricula = await this._gerarMatricula();
        const login = await this._loginUnico(this._gerarLogin(nome));
        dados.matricula = matricula;
        dados.login = login;
        dados.criadoEm = hoje;
        await Database.adicionar("pessoas", dados);
        this._mostrarAlerta(
          "Pessoa cadastrada! Login: " + login + " · Senha: " + dados.senha,
          "sucesso",
          10000
        );
      }
      this.limparForm();
      this.carregar();
    } catch (erro) {
      this._mostrarAlerta("Erro ao salvar: " + erro.message, "erro");
    }
  },

  // Login = primeiro nome + primeiro sobrenome válido, ignorando conectivos
  // (de, da, do, das, dos, e) entre eles.
  // Sem acentos, sem espaços, sem caracteres especiais, tudo em minúsculas.
  // Ex.: "ISMAEL DOS SANTOS RANIERI" -> ismaelsantos; "LUIZ LEVY SANTOS DA SILVA" -> luizlevy
  _gerarLogin(nome) {
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

    const primeiroNome = partes[0];
    const sobrenome = partes.slice(1).find((p) => !conectivos.includes(p)) || "";

    return (primeiroNome + sobrenome).replace(/[^a-z0-9]/g, "");
  },

  // Garante login único no banco (append 2, 3... se já existir); excetoId = ignora a própria pessoa na edição.
  // Compara sem diferenciar maiúsculas/minúsculas e considera também os logins da coleção "usuarios".
  async _loginUnico(base, excetoId) {
    const candidato = base || "usuario";
    const usados = new Set();

    const pessoas = await Database.listarCampos("pessoas", ["id", "login"]);
    pessoas.forEach((p) => {
      if (p.id !== excetoId && p.login) usados.add(String(p.login).toLowerCase());
    });

    try {
      const usuarios = await Database.listarCampos("usuarios", ["usuario"]);
      usuarios.forEach((u) => {
        if (u.usuario) usados.add(String(u.usuario).toLowerCase());
      });
    } catch (erro) {
      // Coleção "usuarios" indisponível: segue apenas com os logins de pessoas
    }

    let login = candidato;
    let n = 2;
    while (usados.has(login.toLowerCase())) {
      login = candidato + n;
      n++;
    }
    return login;
  },

  // Matrícula sequencial no formato AAAA+XXX (ex.: 2026006)
  async _gerarMatricula() {
    const pessoas = await Database.getColecao("pessoas");
    const ano = String(new Date().getFullYear());
    let maior = 0;
    pessoas.forEach((p) => {
      const m = String(p.matricula || "");
      if (m.startsWith(ano)) {
        const n = parseInt(m, 10);
        if (!isNaN(n) && n > maior) maior = n;
      }
    });
    return maior > 0 ? String(maior + 1) : ano + "001";
  },

  // "2010-03-15" -> "15032010"
  _nascimentoParaSenha(dataNascimento) {
    const [ano, mes, dia] = dataNascimento.split("-");
    return dia + mes + ano;
  },

  async editar(id) {
    const pessoa = await Database.getDocumento("pessoas", id);
    if (!pessoa) return;

    this.editandoId = id;
    document.getElementById("nome").value = pessoa.nome;
    document.getElementById("categoria").value = pessoa.categoria;
    document.getElementById("turmaSetor").value = pessoa.turmaSetor || "";
    document.getElementById("dataNascimento").value = pessoa.dataNascimento || "";
    // Na edição o nascimento é opcional (se vazio, senha original permanece)
    document.getElementById("dataNascimento").removeAttribute("required");
    window.scrollTo({ top: 0, behavior: "smooth" });
  },

  async excluir(id) {
    if (!confirm("Tem certeza que deseja excluir esta pessoa?")) return;
    try {
      await Database.excluir("pessoas", id);
      this._mostrarAlerta("Pessoa excluída com sucesso!", "sucesso");
      this.carregar();
    } catch (erro) {
      this._mostrarAlerta("Erro ao excluir: " + erro.message, "erro");
    }
  },

  async excluirTodos() {
    let pessoas = [];
    try {
      pessoas = await Database.listarCampos("pessoas", ["id"]);
    } catch (erro) {
      this._mostrarAlerta("Erro ao listar pessoas: " + erro.message, "erro");
      return;
    }
    if (pessoas.length === 0) {
      this._mostrarAlerta("Nenhuma pessoa cadastrada.", "aviso");
      return;
    }
    const confirmar = confirm(
      "Tem certeza que deseja excluir TODAS as " + pessoas.length +
      " pessoas cadastradas?\n\nEssa ação não pode ser desfeita."
    );
    if (!confirmar) return;
    try {
      await Database.excluirTodos("pessoas");
      this._mostrarAlerta("Todas as " + pessoas.length + " pessoas foram excluídas!", "sucesso", 6000);
      this.carregar();
    } catch (erro) {
      this._mostrarAlerta("Erro ao excluir: " + erro.message, "erro");
    }
  },

  limparForm() {
    this.editandoId = null;
    document.getElementById("form-cadastro").reset();
    document.getElementById("dataNascimento").setAttribute("required", "");
  },

  _renderizarTabela(pessoas) {
    const container = document.getElementById("tabela-pessoas");
    if (pessoas.length === 0) {
      container.innerHTML = "<p style='color:#999;'>Nenhuma pessoa cadastrada.</p>";
      return;
    }

    const catLabel = { aluno: "Aluno(a)", professor: "Professor(a)", funcionario: "Funcionário(a)" };

    let html = '<table class="tabela"><thead><tr>';
    html += '<th>Nome</th><th>Login</th><th>Matrícula</th><th>Categoria</th><th>Turma/Setor</th><th>Ações</th>';
    html += '</tr></thead><tbody>';

    pessoas.forEach((p) => {
      html += "<tr>";
      html += "<td>" + p.nome + "</td>";
      html += "<td>" + (p.login || "-") + "</td>";
      html += "<td>" + (p.matricula || "-") + "</td>";
      html += "<td>" + (catLabel[p.categoria] || p.categoria) + "</td>";
      html += "<td>" + (p.turmaSetor || "-") + "</td>";
      html += '<td><div class="acao-botoes">';
      html += '<button class="btn btn-azul" onclick="Cadastro.editar(\'' + p.id + '\')">Editar</button>';
      html += '<button class="btn btn-vermelho" onclick="Cadastro.excluir(\'' + p.id + '\')">Excluir</button>';
      html += "</div></td>";
      html += "</tr>";
    });

    html += "</tbody></table>";
    container.innerHTML = html;
  },

  _mostrarAlerta(msg, tipo, duracao = 4000) {
    const alerta = document.getElementById("alerta-cadastro");
    alerta.textContent = msg;
    alerta.className = "alerta alerta-" + tipo;
    setTimeout(() => alerta.classList.add("oculto"), duracao);
  }
};

(function () {
  if (!Auth.verificarAcesso([])) return;
  const usuario = Auth.getUsuarioLogado();

  document.getElementById("usuario-nome").textContent = usuario.nome;
  Cadastro.carregar();
})();
