# 🔐 Pipeline DevSecOps

Este documento descreve a pipeline definida em `pipeline.yml`, detalhando o que cada etapa executa e por que as ferramentas utilizadas são importantes para a segurança do processo de entrega.

O link da sua URL de produção: https://tiagopelles.github.io/projeto-devsecops-desafio

## Visão geral

A pipeline está dividida em dois jobs:

1. **Build, Segurança e Assinatura**: obtém o código, executa verificações de segurança, empacota o site, calcula seu hash, assina o artefato e o disponibiliza para o próximo job.
2. **Verificação e Deploy**: baixa o artefato produzido, prepara sua validação, extrai o conteúdo e publica o site no GitHub Pages.

O job de deploy possui a dependência `needs: build`. Portanto, ele somente é iniciado depois da conclusão bem-sucedida do job de build.

## Acionamento e permissões

### Acionamento da pipeline

```yaml
on:
  push:
    branches:
      - main
```

A pipeline é executada automaticamente quando ocorre um `push` na branch `main`.

### Permissões

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

- **`contents: read`**: permite que o workflow leia o conteúdo do repositório.
- **`pages: write`**: permite publicar o site no GitHub Pages.
- **`id-token: write`**: permite a emissão de token OIDC, utilizado em fluxos de autenticação sem armazenamento de credenciais permanentes, como a assinatura keyless com Cosign.

### Importância para a segurança

A declaração explícita de permissões ajuda a aplicar o princípio do menor privilégio. O workflow recebe somente os acessos necessários para ler o código, assinar o artefato e realizar a publicação.

---

# Job 1: Build, Segurança e Assinatura

```yaml
build:
  name: Build, Segurança e Assinatura
  runs-on: ubuntu-latest
```

Esse job executa em um runner Ubuntu e concentra as verificações de segurança e a preparação do artefato que será implantado.

## 1. Checkout do código

```yaml
- name: 📥 Checkout do Código
  uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

### O que faz

Baixa o conteúdo do repositório para o runner, permitindo que as etapas seguintes acessem e analisem os arquivos. O parâmetro `fetch-depth: 0` solicita o histórico completo do Git, em vez de apenas o commit mais recente.

### Por que é importante para a segurança

O histórico completo permite que ferramentas de análise, especialmente scanners de segredos, examinem não apenas o estado atual dos arquivos, mas também informações presentes no histórico do repositório. Isso é relevante porque remover um segredo do arquivo atual não o elimina automaticamente dos commits anteriores.

---

## 2. Build

```yaml
- name: ⚙️ Build
  run: |
    echo "Verificando arquivos..."
    ls src/
    echo "Build OK!"
```

### O que faz

Lista os arquivos do diretório `src/` e registra uma mensagem de sucesso. No estado atual, essa etapa funciona como uma validação simples da existência e acessibilidade dos arquivos, sem compilar, testar ou gerar uma aplicação.

### Por que é importante para a segurança

Uma etapa de build controlada é o ponto adequado para validar se o código pode ser preparado de maneira reproduzível. Em aplicações que exigem compilação, essa fase também pode impedir que artefatos incompletos ou inválidos avancem na pipeline.


---

## 3. Secrets Scanning com Gitleaks

```yaml
- name: 🔑 Secrets Scanning
  uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### O que faz

Executa o Gitleaks sobre o repositório para identificar possíveis segredos expostos, como tokens, senhas, chaves privadas e credenciais adicionadas indevidamente ao código ou ao histórico do Git.

### Por que o Gitleaks é importante para a segurança

Credenciais versionadas podem ser utilizadas para acesso não autorizado a sistemas, APIs, bancos de dados e ambientes de nuvem. O Gitleaks antecipa esse risco ao inserir a detecção de segredos no fluxo de integração contínua.

O uso dessa ferramenta contribui para:

- evitar a publicação de credenciais;
- reduzir o risco de vazamento de tokens e chaves;
- detectar segredos mantidos no histórico do Git;
- interromper a entrega antes que uma exposição alcance a produção.

---

## 4. SAST com Semgrep

```yaml
- name: 🔍 SAST - Semgrep
  run: |
    python3 -m pip install --upgrade pip
    pip install semgrep
    semgrep scan \
      --config auto \
      --config p/xss \
      --error \
      src/
```

### O que faz

Instala o Semgrep e executa uma análise estática no diretório `src/`.

- **`--config auto`**: seleciona regras automaticamente de acordo com as tecnologias identificadas.
- **`--config p/xss`**: adiciona regras direcionadas à detecção de padrões associados a Cross-Site Scripting (XSS).
- **`--error`**: faz o comando retornar erro quando o Semgrep encontra resultados, impedindo o avanço da pipeline.
- **`src/`**: limita a análise ao código-fonte localizado nesse diretório.

### Por que o Semgrep é importante para a segurança

O Semgrep realiza SAST, ou Static Application Security Testing. Essa abordagem examina o código sem precisar colocar a aplicação em execução e ajuda a encontrar padrões inseguros durante o desenvolvimento.

Ele contribui para:

- identificar vulnerabilidades antes do deploy;
- detectar práticas de codificação inseguras;
- fornecer retorno rápido aos desenvolvedores;
- transformar regras de segurança em verificações automatizadas;
- bloquear a pipeline quando uma ocorrência viola o critério configurado.

A configuração específica para XSS é relevante porque scripts publicados no navegador podem processar dados não confiáveis e inserir conteúdo inseguro em páginas HTML.

---

## 5. SCA com Grype

```yaml
- name: 📦 SCA - Grype
  run: |
    echo "Gerando package-lock.json..."
    npm install --package-lock-only --no-audit --no-fund
    echo "Instalando Grype..."
    curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin
    echo "Executando análise de dependências..."
    grype dir:. --fail-on medium
```

### O que faz

A etapa executa três ações principais:

1. Gera ou atualiza o `package-lock.json`, sem executar a auditoria nativa do npm e sem exibir mensagens de financiamento.
2. Instala o Grype no runner.
3. Analisa o diretório do projeto em busca de componentes com vulnerabilidades conhecidas.

A opção `--fail-on medium` faz a verificação falhar ao detectar vulnerabilidades com severidade média ou superior.

### Por que o Grype é importante para a segurança

O Grype executa SCA, ou Software Composition Analysis. Enquanto o SAST avalia principalmente o código desenvolvido pela equipe, o SCA examina bibliotecas, pacotes e demais componentes de terceiros utilizados pela aplicação.

Essa etapa contribui para:

- identificar dependências vulneráveis;
- detectar riscos conhecidos no pipeline do software;
- impedir que componentes acima do limite de severidade avancem para produção;
- apoiar a atualização de versões vulneráveis;
- dar visibilidade aos riscos introduzidos por código de terceiros.

---

## 6. Empacotamento do artefato

```yaml
- name: 📦 Empacotar artefato do site
  run: |
    tar \
      --dereference --hard-dereference \
      -C src \
      -cvf artifact.tar \
      --exclude=.git --exclude=.github \
      .
```

### O que faz

Empacota o conteúdo do diretório `src/` no arquivo `artifact.tar`. Os diretórios `.git` e `.github` são excluídos, e referências simbólicas ou hard links são tratadas conforme as opções informadas.

### Por que é importante para a segurança

Empacotar o conteúdo cria uma unidade de entrega definida. Isso reduz a possibilidade de o job de deploy reconstruir o site de forma diferente ou publicar arquivos que não passaram pelas verificações anteriores.

A exclusão de metadados do Git e arquivos de automação também evita incluir conteúdo desnecessário no site publicado.

---

## 7. Cálculo do hash SHA-256

```yaml
- name: 🔢 Hash do artefato
  run: |
    digest=$(sha256sum artifact.tar | awk '{print $1}')
    echo "$digest" > artifact.tar.sha256
    echo "SHA256: $digest"
```

### O que faz

Calcula o hash SHA-256 do arquivo `artifact.tar`, grava o resultado em `artifact.tar.sha256` e exibe o digest no log da execução.

### Por que o SHA-256 é importante para a segurança

O hash funciona como uma impressão digital do artefato. Qualquer alteração no arquivo resulta em um digest diferente, permitindo detectar modificações ou corrupção.

Entretanto, o hash isolado não comprova quem produziu o arquivo. Para autenticidade, ele deve ser associado a um mecanismo confiável de assinatura ou validação.

---

## 8. Instalação do Cosign

```yaml
- name: ✍️ Instalar Cosign
  uses: sigstore/cosign-installer@v3
```

### O que faz

Instala o Cosign no runner para que o artefato possa ser assinado.

### Por que o Cosign é importante para a segurança

O Cosign permite associar uma identidade verificável ao artefato. Isso ajuda a proteger o pipeline ao permitir que o ambiente de destino valide se o arquivo foi produzido pelo workflow esperado e se permaneceu íntegro.

---

## 9. Assinatura do artefato

```yaml
- name: ✍️ Assinar artefato
  run: |
    cosign sign-blob artifact.tar \
      --bundle artifact.sigstore.json \
      --yes
    echo "Artefato assinado com sucesso."
```

### O que faz

Assina o arquivo `artifact.tar` com o Cosign e registra o material necessário à verificação no bundle `artifact.sigstore.json`.

### Por que a assinatura é importante para a segurança

A assinatura fornece garantias complementares ao hash:

- **Integridade**: ajuda a detectar alterações no artefato depois da assinatura.
- **Autenticidade**: permite validar a identidade associada à assinatura.
- **Rastreabilidade**: relaciona o artefato ao processo automatizado que o produziu.
- **Proteção do pipeline**: reduz o risco de implantação de um arquivo substituído entre build e deploy.

O fluxo utiliza a permissão `id-token: write`, compatível com autenticação OIDC e assinatura sem chave privada persistente no repositório.

---

## 10. Upload do artefato assinado

```yaml
- name: ⬆️ Upload do artefato assinado
  uses: actions/upload-artifact@v4
  with:
    name: site-assinado
    path: |
      artifact.tar
      artifact.sigstore.json
      artifact.tar.sha256
    retention-days: 1
```

### O que faz

Publica como artefato temporário da execução:

- o pacote do site;
- o bundle de assinatura;
- o hash SHA-256.

O artefato recebe o nome `site-assinado` e possui retenção de um dia.

### Por que é importante para a segurança

Essa etapa transfere para o job de deploy exatamente os arquivos produzidos no job anterior. A retenção curta reduz a janela de armazenamento do artefato no GitHub Actions.

A publicação conjunta do pacote, da assinatura e do hash disponibiliza os elementos necessários para validar integridade e autenticidade antes da implantação.

---

# Job 2: Verificação e Deploy

```yaml
deploy:
  name: Verificação e Deploy
  needs: build
  runs-on: ubuntu-latest
```

Esse job depende do sucesso do job `build`. Ele baixa o artefato já analisado, prepara sua publicação e realiza o deploy no GitHub Pages.

## 11. Download do artefato assinado

```yaml
- name: ⬇️ Baixar o artefato assinado
  uses: actions/download-artifact@v4.1.3
  with:
    name: site-assinado
```

### O que faz

Baixa o artefato `site-assinado`, produzido no job anterior, para o runner de deploy.

### Por que é importante para a segurança

A separação entre build e deploy reduz o acoplamento das responsabilidades. O deploy consome um artefato previamente produzido, em vez de reconstruir o código.

---

## 12. Instalação do Cosign no job de deploy

```yaml
- name: ✍️ Instalar Cosign
  uses: sigstore/cosign-installer@v3
```

### O que faz

Instala o Cosign no runner do job de deploy, preparando o ambiente para validar a assinatura gerada durante o build.

### Por que é importante para a segurança

A verificação deve ocorrer no ambiente que consome o artefato. Instalar o Cosign no job de deploy permite estabelecer uma barreira de confiança imediatamente antes da publicação.

---

## 13. Verificação da assinatura do artefato

```yaml
  - name: 🔎 Verificar assinatura do artefato
    run: |
          cosign verify-blob artifact.tar \
            --bundle artifact.sigstore.json \
            --certificate-identity-regexp "^https://github.com/${{ github.repository }}/.github/workflows/.*" \
            --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
          echo "Assinatura válida — artefato íntegro e autêntico."  
```

### O que faz

Valida a assinatura do `artifact.tar` usando o bundle produzido no job de build. Também restringe a identidade esperada ao workflow do repositório e o emissor OIDC ao provedor de tokens do GitHub Actions.

### Por que essa verificação é importante para a segurança

Assinar sem verificar não protege o deploy. A validação é a etapa que efetivamente impede a publicação quando:

- o artefato foi modificado após a assinatura;
- o bundle não corresponde ao arquivo;
- a assinatura não está associada à identidade esperada;
- o emissor do certificado não é o esperado.

---

## 14. Extração do site

```yaml
- name: 📂 Extrair site verificado
  run: |
    mkdir -p site
    tar -xvf artifact.tar -C site
```

### O que faz

Cria o diretório `site` e extrai nele o conteúdo de `artifact.tar`.

### Por que é importante para a segurança

A extração prepara exatamente o conteúdo empacotado no job anterior para publicação, evitando uma nova geração do site no job de deploy.

---

## 15. Configuração do GitHub Pages

```yaml
- name: 🌐 Configurar GitHub Pages
  uses: actions/configure-pages@v4
```

### O que faz

Configura o ambiente do GitHub Actions para a publicação no GitHub Pages.

### Por que é importante para a segurança

Utilizar a action específica para configuração do Pages padroniza a preparação do ambiente de implantação e integra o workflow ao mecanismo de publicação da plataforma.

---

## 16. Upload para produção

```yaml
- name: 📤 Upload para Produção
  uses: actions/upload-pages-artifact@v3
  with:
    path: ./site
```

### O que faz

Empacota e envia o diretório `./site` como artefato compatível com o processo de publicação do GitHub Pages.

### Por que é importante para a segurança

Essa etapa delimita o conteúdo que será publicado. Somente o diretório `site`, originado do artefato transferido entre os jobs, é encaminhado ao mecanismo de deploy.

---

## 17. Deploy em produção

```yaml
- name: 🚀 Deploy em Produção
  id: deployment
  uses: actions/deploy-pages@v4
```

### O que faz

Publica no GitHub Pages o artefato preparado na etapa anterior. O identificador `deployment` permite que a URL retornada pelo deploy seja utilizada na configuração do ambiente.

### Por que é importante para a segurança

A implantação fica condicionada ao sucesso das etapas anteriores do job. Em um fluxo totalmente protegido, isso significa que somente um artefato aprovado pelas análises e validado criptograficamente deve alcançar a produção.

---

# Resumo das ferramentas de segurança

| Ferramenta ou controle | Categoria | Finalidade principal |
|---|---|---|
| Gitleaks | Secrets Scanning | Detectar credenciais e segredos expostos no código e no histórico do Git. |
| Semgrep | SAST | Identificar padrões inseguros e vulnerabilidades no código-fonte. |
| Grype | SCA | Detectar vulnerabilidades conhecidas em dependências e componentes de terceiros. |
| SHA-256 | Integridade | Gerar uma impressão digital do artefato para detectar alterações. |
| Cosign | Assinatura de artefatos | Comprovar integridade e autenticidade do artefato antes do deploy. |
| OIDC | Identidade do workload | Permitir autenticação temporária do workflow sem chave privada persistente. |
| GitHub Actions Artifacts | Transferência entre jobs | Transportar o mesmo artefato do build para o deploy. |
| GitHub Pages Actions | Deploy | Padronizar a preparação e a publicação do conteúdo no GitHub Pages. |

# Controles aplicados pela pipeline

A pipeline combina diferentes camadas de segurança:

1. **Segredos**: Gitleaks verifica possíveis credenciais expostas.
2. **Código-fonte**: Semgrep busca padrões de implementação inseguros.
3. **Dependências**: Grype identifica vulnerabilidades conhecidas em componentes de terceiros.
4. **Integridade**: SHA-256 permite detectar alterações no pacote.
5. **Autenticidade**: Cosign associa o artefato a uma identidade verificável.
6. **Promoção controlada**: o deploy reutiliza o artefato produzido no build.
7. **Menor privilégio**: as permissões do workflow são declaradas explicitamente.
