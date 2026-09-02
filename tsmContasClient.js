// Cliente de la API TSM Contas: hace login para obtener un token y lo usa
// para consultar si la tarjeta tiene un consumo abierto (pago pendiente)
// antes de decidir qué puerta abrir.

// Margen antes de "validate" para renovar el token con anticipación en vez
// de esperar a que la API lo rechace.
const TOKEN_REFRESH_MARGIN_MS = 30 * 1000;

// Si la API no responde en este tiempo (colgada, red caída, etc.) se corta
// en vez de dejar a la persona esperando en el tótem sin límite.
const HTTP_TIMEOUT_MS = 60 * 1000;

async function fetchWithTimeout(url, options, timeoutErrorMessage) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error(`${timeoutErrorMessage}: no respondió en ${HTTP_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}

class TsmContasClient {
  constructor({ host, port, usuario, senha }) {
    this.baseUrl = `http://${host}:${port}`;
    this.usuario = usuario;
    this.senha = senha;

    this.cachedToken = null;
    this.cachedTokenValidUntilMs = 0;
  }

  async login() {
    const url = `${this.baseUrl}/datasnap/rest/TSMContasInterfaceWeb_SER/GetToken`;
    const body = JSON.stringify({ usuario: this.usuario, senha: this.senha });

    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      },
      'Login TSM falló'
    );

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Login TSM falló: HTTP ${response.status} - ${responseText}`);
    }

    let json;
    try {
      json = JSON.parse(responseText);
    } catch {
      throw new Error(`Respuesta de login TSM no es JSON válido: ${responseText}`);
    }

    const token = json.token && json.token.token;
    const validate = json.token && json.token.validade;
    if (!token || !validate) {
      throw new Error(`Respuesta de login TSM con forma inesperada: ${responseText}`);
    }

    this.cachedToken = token;
    this.cachedTokenValidUntilMs = Date.parse(validate);
    return token;
  }

  async getValidToken() {
    if (this.cachedToken && Date.now() < this.cachedTokenValidUntilMs - TOKEN_REFRESH_MARGIN_MS) {
      return this.cachedToken;
    }
    return this.login();
  }

  /**
   * Devuelve true si la tarjeta tiene un consumo abierto (pago pendiente ->
   * acceso denegado), false si está al día.
   * Tira una excepción si la API no responde o la respuesta no tiene la
   * forma esperada ({"result":[true]} / {"result":[false]}).
   */
  async isCartaoConsumoAberto(cardCode, { codigoEmpresa }) {
    const url = `${this.baseUrl}/datasnap/rest/TSMContasInterfaceWeb_SER/IsCartaoConsumoAberto`;
    const body = JSON.stringify({
      CodigoEmpresa: codigoEmpresa,
      IdIdentificacaoCartao: cardCode,
    });

    const doRequest = async (token) =>
      fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body,
        },
        'Consulta TSM falló'
      );

    let token = await this.getValidToken();
    let response = await doRequest(token);

    if (response.status === 401) {
      // El token cacheado puede haber quedado inválido antes de tiempo
      // (revocado del lado del servidor, reloj desalineado, etc.): se pide
      // uno nuevo y se reintenta una sola vez.
      token = await this.login();
      response = await doRequest(token);
    }

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Consulta TSM falló: HTTP ${response.status} - ${responseText}`);
    }

    let json;
    try {
      json = JSON.parse(responseText);
    } catch {
      throw new Error(`Respuesta TSM no es JSON válido: ${responseText}`);
    }

    if (!Array.isArray(json.result) || typeof json.result[0] !== 'boolean') {
      throw new Error(`Respuesta TSM con forma inesperada: ${responseText}`);
    }

    return json.result[0];
  }
}

module.exports = { TsmContasClient };
