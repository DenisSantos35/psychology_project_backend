# Guia Frontend - Auth do App Cliente

Este guia mostra como o front do app cliente deve consumir as APIs de login,
recuperacao de senha e logout do paciente.

Base URL local:

```text
http://localhost:3000/api/client/auth
```

Em producao, trocar o dominio conforme o ambiente.

## 1. Login

Endpoint:

```http
POST /api/client/auth/login
Content-Type: application/json
```

Body:

```json
{
  "email": "ricardo.almeida@email.com",
  "password": "senha-do-paciente",
  "remember_me": true
}
```

Resposta 200:

```json
{
  "access_token": "jwt",
  "refresh_token": "jwt",
  "user": {
    "id": "uuid-do-usuario",
    "patient_id": "uuid-do-paciente",
    "name": "Ricardo Almeida",
    "email": "ricardo.almeida@email.com",
    "role": "patient"
  }
}
```

O front deve:

- Enviar apenas `email`, `password` e `remember_me`.
- Nunca enviar `patient_id` no login.
- Salvar `access_token`, `refresh_token` e `user`.
- Usar `access_token` no header das rotas privadas.
- Usar `user.patient_id` para identificar o paciente logado nas telas do app.

Header para rotas privadas:

```http
Authorization: Bearer {access_token}
```

Tratamento de erros:

```text
400 - dados invalidos
401 - email ou senha invalidos
403 - usuario nao e paciente ou nao tem acesso ao app cliente
429 - muitas tentativas
```

Mensagem sugerida no app:

- `400`: "Confira os dados informados."
- `401`: "E-mail ou senha invalidos."
- `403`: "Este acesso nao esta liberado para o app do paciente."
- `429`: "Muitas tentativas. Tente novamente em alguns minutos."

## 2. Recuperar Senha

Endpoint:

```http
POST /api/client/auth/forgot-password
Content-Type: application/json
```

Body:

```json
{
  "email": "ricardo.almeida@email.com"
}
```

Resposta 200:

```json
{
  "message": "Se o e-mail existir, enviaremos instrucoes de recuperacao."
}
```

O front deve:

- Mostrar sempre a mesma mensagem de sucesso.
- Nao tentar descobrir se o e-mail existe.
- Depois do envio, orientar o paciente a abrir o e-mail de recuperacao.
- O e-mail usado deve ser o e-mail cadastrado pelo administrador no paciente.

Mensagem sugerida:

```text
Se o e-mail existir, enviaremos instrucoes de recuperacao.
```

Importante:

- O backend nao revela se o e-mail existe.
- Quando o paciente ainda nao tiver senha, esse fluxo prepara o acesso para ele
  criar/redefinir a senha e depois fazer login no app.
- Para o token chegar ao app, o backend deve ter `CLIENT_RESET_PASSWORD_URL`
  configurado, preferencialmente `psycologi://auth/reset-password`.
- O link do e-mail deve abrir essa URL com `?token=...`.
- Tambem ha compatibilidade no app com `psycologi:///reset-password` e
  `psycologi://reset-password`, mas use `psycologi://auth/reset-password`.

## 3. Redefinir Senha

Endpoint:

```http
POST /api/client/auth/reset-password
Content-Type: application/json
```

Body:

```json
{
  "token": "token-recebido-no-link",
  "password": "novaSenha123"
}
```

Resposta 200:

```json
{
  "message": "Senha redefinida com sucesso."
}
```

O front deve:

- Ler o `token` que veio no link de recuperacao.
- Exemplo de link: `psycologi://auth/reset-password?token=abc123`.
- Pedir a nova senha para o paciente.
- Enviar `token` e `password`.
- Depois do sucesso, mandar o paciente para a tela de login.

Tratamento de erros:

```text
400 - token invalido, expirado ou senha invalida
403 - usuario nao e paciente ou nao tem acesso ao app cliente
429 - muitas tentativas
```

## 4. Logout

Endpoint:

```http
POST /api/client/auth/logout
Authorization: Bearer {access_token}
```

Resposta 200:

```json
{
  "message": "Logout realizado"
}
```

O front deve:

- Chamar o endpoint de logout quando o paciente sair da conta.
- Limpar `access_token`, `refresh_token` e dados do usuario do armazenamento local.
- Redirecionar para a tela de login.

Mesmo se a API falhar no logout, o app pode limpar os dados locais para encerrar
a sessao no dispositivo.

## 5. Armazenamento no App

Dados minimos para guardar apos login:

```json
{
  "access_token": "jwt",
  "refresh_token": "jwt",
  "user": {
    "id": "uuid-do-usuario",
    "patient_id": "uuid-do-paciente",
    "name": "Ricardo Almeida",
    "email": "ricardo.almeida@email.com",
    "role": "patient"
  }
}
```

Recomendacao:

- Mobile: usar storage seguro, como Secure Storage/Keychain/Keystore.
- Web: evitar `localStorage` para tokens sensiveis quando houver alternativa mais segura.
- Se `remember_me` for `false`, manter a sessao apenas no armazenamento de sessao/memoria.
- Se `remember_me` for `true`, persistir a sessao conforme o padrao do app.

## 6. Fluxo Das Telas

### Tela Login

1. Usuario informa e-mail e senha.
2. Usuario marca ou nao `remember_me`.
3. App chama `POST /api/client/auth/login`.
4. Se sucesso, salva tokens e usuario.
5. App abre a Home.
6. Se erro, mostra mensagem amigavel.

### Tela Recuperar Senha

1. Usuario informa e-mail.
2. App chama `POST /api/client/auth/forgot-password`.
3. App mostra a mensagem generica de sucesso.
4. Usuario acessa o link do e-mail.
5. App abre a tela de nova senha com o `token`.
6. App chama `POST /api/client/auth/reset-password`.
7. Usuario volta para login e entra com a nova senha.

## 7. Exemplo TypeScript

```ts
const API_BASE_URL = "http://localhost:3000/api/client/auth";

type ClientAuthUser = {
  id: string;
  patient_id: string;
  name: string;
  email: string;
  role: "patient";
};

type LoginResponse = {
  access_token: string;
  refresh_token: string;
  user: ClientAuthUser;
};

export async function loginClientPatient(input: {
  email: string;
  password: string;
  remember_me: boolean;
}): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error("E-mail ou senha invalidos.");
    if (response.status === 403) throw new Error("Acesso nao liberado para o app do paciente.");
    if (response.status === 429) throw new Error("Muitas tentativas. Tente novamente em alguns minutos.");
    throw new Error("Nao foi possivel entrar. Confira os dados.");
  }

  return response.json();
}

export async function forgotClientPassword(email: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error("Muitas tentativas. Tente novamente em alguns minutos.");
    throw new Error("Nao foi possivel solicitar a recuperacao.");
  }

  const data = await response.json();
  return data.message;
}

export async function resetClientPassword(input: {
  token: string;
  password: string;
}): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    if (response.status === 400) throw new Error("Link invalido, expirado ou senha invalida.");
    if (response.status === 403) throw new Error("Acesso nao liberado para o app do paciente.");
    if (response.status === 429) throw new Error("Muitas tentativas. Tente novamente em alguns minutos.");
    throw new Error("Nao foi possivel redefinir a senha.");
  }

  const data = await response.json();
  return data.message;
}

export async function logoutClientPatient(accessToken: string): Promise<void> {
  await fetch(`${API_BASE_URL}/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
```

## 8. Exemplo Flutter/Dart

```dart
class ClientAuthApi {
  ClientAuthApi(this.baseUrl);

  final String baseUrl;

  Future<Map<String, dynamic>> login({
    required String email,
    required String password,
    required bool rememberMe,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/client/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'email': email,
        'password': password,
        'remember_me': rememberMe,
      }),
    );

    if (response.statusCode == 200) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }

    if (response.statusCode == 401) {
      throw Exception('E-mail ou senha invalidos.');
    }
    if (response.statusCode == 403) {
      throw Exception('Acesso nao liberado para o app do paciente.');
    }
    if (response.statusCode == 429) {
      throw Exception('Muitas tentativas. Tente novamente em alguns minutos.');
    }

    throw Exception('Nao foi possivel entrar. Confira os dados.');
  }

  Future<String> forgotPassword(String email) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/client/auth/forgot-password'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email}),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      return data['message'] as String;
    }

    if (response.statusCode == 429) {
      throw Exception('Muitas tentativas. Tente novamente em alguns minutos.');
    }

    throw Exception('Nao foi possivel solicitar a recuperacao.');
  }

  Future<String> resetPassword({
    required String token,
    required String password,
  }) async {
    final response = await http.post(
      Uri.parse('$baseUrl/api/client/auth/reset-password'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'token': token,
        'password': password,
      }),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      return data['message'] as String;
    }

    if (response.statusCode == 400) {
      throw Exception('Link invalido, expirado ou senha invalida.');
    }
    if (response.statusCode == 403) {
      throw Exception('Acesso nao liberado para o app do paciente.');
    }
    if (response.statusCode == 429) {
      throw Exception('Muitas tentativas. Tente novamente em alguns minutos.');
    }

    throw Exception('Nao foi possivel redefinir a senha.');
  }

  Future<void> logout(String accessToken) async {
    await http.post(
      Uri.parse('$baseUrl/api/client/auth/logout'),
      headers: {'Authorization': 'Bearer $accessToken'},
    );
  }
}
```

## 9. Checklist Frontend

- Login envia `email`, `password`, `remember_me`.
- Login nao envia `patient_id`.
- Token salvo apos login.
- `patient_id` salvo a partir da resposta.
- Home abre usando `access_token`.
- Recuperar senha mostra mensagem generica.
- Redefinir senha envia `token` e `password`.
- Logout limpa sessao local.
- Erros `401`, `403` e `429` tratados com mensagem amigavel.
