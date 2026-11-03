# Revisión de seguridad — 2026-11-03

Sitio: https://expresion-juridica-21-st.replit.app/ . Revisión de código, dependencias, recursos públicos y controles con datos sintéticos. No se hicieron ataques, intentos de acceso a cuentas reales ni llamadas de pago a IA.

Estado: publicado en Replit y verificado en producción el 2026-11-03 a las 13:31 (America/Monterrey). Replit mostró `Current status Live`; se comprobó la misma versión de `web-security.mjs` mediante SHA-256 antes de publicar.

## Correcciones

- CSP aplicada por cabecera. Los scripts se limitan al origen propio, hashes de bloques confiables y el proveedor autorizado de Analytics. No se permite `unsafe-inline` ni `unsafe-eval` en scripts; los handlers inline quedan bloqueados. Se conservan estilos dinámicos necesarios para animaciones/editor, HLS, workers y vistas PDF/HTML.
- Cabeceras nosniff, frame-ancestors/X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP y HSTS en HTTPS. Sin CORS abierto. Las mutaciones de API rechazan orígenes ajenos.
- Cookies de sesión con Secure, HttpOnly y SameSite=Lax. CSRF con Secure en los entornos alojados; conserva lectura desde el cliente para la validación entre pestañas. Consentimiento con Secure sobre HTTPS.
- Respuestas administrativas y privadas con `private, no-store`, incluso si un handler intenta aplicar una política de caché menos restrictiva.
- Logger temprano para la aplicación y dependencias: eventos, nivel, código permitido, tipo de error y referencia aleatoria de solicitud. Excluye mensajes y objetos completos, stacks, cabeceras, cookies, claves, payloads, correos, nombres e identificadores de usuario. Better Auth utiliza el mismo logger privado. Los fallos fatales se registran sin volcar su contenido.
- Errores de API, trabajos y almacenamiento con códigos y textos controlados. No se devuelve al cliente el mensaje arbitrario del proveedor.
- Cargas limitadas por combinación de extensión y tipo. Nuevas URLs de medios usan nombres UUID sin el nombre original. Se exige registro de medio válido y un nombre seguro; las lecturas locales quedan contenidas en su raíz. Los documentos activos de medios se sirven con CSP sin scripts y sandbox.
- Dependencias transitivas fijadas a `image-size@2.0.4` y `uuid@11.1.1`. Se mantuvieron las versiones de PptxGenJS y Replit Object Storage y se comprobó compatibilidad. No se usó `npm audit fix --force`.

El historial autorizado de actividad del CMS mantiene trazabilidad de acciones dentro del panel privado. No se confunde con la consola del servidor. No se borraron registros históricos ni se rotaron contraseñas o Secrets reales.

## Resultados de pruebas

| Control | Resultado |
|---|---|
| `npm audit` local y Replit | 0 alertas conocidas después del cambio; 8 antes |
| Patrones de credenciales en archivos rastreados | Sin hallazgos en 133 archivos de texto del corte final; 126 en el inicial |
| Patrones de credenciales en historia Git disponible | Sin hallazgos en 315 blobs de texto únicos |
| Recursos públicos y estado anónimo | 8 recursos revisados sin hallazgos de claves; sin identidad ni colecciones privadas en la respuesta anónima |
| Privacidad de consola/errores fatales | Verificada con claves e identidad ficticias, sin imprimir sus valores |
| CSP/cookies/no-store/origen/tipos de carga | Pruebas de servidor correctas, local y Replit |
| Autenticación real sobre SQLite temporal | 8 rutas privadas rechazadas sin sesión, registro cerrado tras propietario, cookies protegidas, guardado autenticado y CSRF obligatorio |
| Política adicional de Replit | Cambio de contraseña inicial atendido en la cuenta sintética; protección conservada |
| PPTX e imágenes | Formatos nativos, fuentes y proporciones comprobados localmente y en Replit |
| Posts y documentos | Tests locales de HTML/PNG/ZIP/copy, edición, persistencia, membrete y DOCX/PDF correctos |
| SEO y rangos de video | 18 fuentes, 17 canónicas, 24 bindings y respuestas parciales preservados; local y Replit |
| Navegador con CSP local | Sitio interactivo y HLS de 97 segundos en reproducción, sin errores CSP observados |
| HTTP de producción después de Publish | 11 respuestas revisadas: CSP activa, 8 APIs privadas con 401, no-store privado y estado anónimo sin identidad/token CSRF |
| Navegador de producción con CSP | Video de 97 segundos reproduciendo, readyState 4, sin error de medio ni errores CSP/JavaScript observados |
| CMS autenticado en producción | Indexación conservada; bibliotecas de 4 sets sociales, 4 documentos y 3 presentaciones cargan sin errores. Un HTML social conserva sus 5 campos editables dentro del sandbox; un documento abre con 9 párrafos justificados y vista PDF. Sin errores CSP/JavaScript observados. No se modificó contenido del propietario |

Los comandos reproducibles son `node scripts/check-security.mjs`, `node scripts/check-auth-security.mjs` y `node scripts/check-secret-exposure.mjs`, además de las suites de exportación existentes. La prueba de autenticación usa un directorio y base temporales sin heredar Secrets reales; no altera usuarios de producción. Las pruebas de generación usan un proveedor simulado.

## Cookie GAESA e infraestructura

`GAESA` procede de la infraestructura de Google para Replit y contiene un identificador de enrutamiento. La aplicación no puede cambiar sus atributos. Véase la [explicación oficial de Replit](https://replit.com/help/answers/why-does-a-pci-or-security-scan-flag-the-gaesa-cookie-on-my-published-app). No se intentó sobrescribirla ni alterar el enrutamiento de la plataforma.

## Límites y continuidad

La detección por patrones y `npm audit` no certifican ausencia universal de vulnerabilidades. La protección del logger se aplica a nuevas ejecuciones; no prueba ni elimina el contenido de archivos históricos del proveedor. Los recursos del cliente, las bases y los Secrets no se incluyen en este informe.

La versión de Replit contiene controles y personalizaciones adicionales; se preservaron con parches de ancla exacta y respaldo, sin reemplazar sus archivos compartidos completos. Mantener separadas configuración local, workspace y deployment. Search Console continúa siendo una integración pendiente independiente de esta revisión.

Referencias técnicas: [CSP de MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP) y [cookies de Better Auth](https://better-auth.com/docs/concepts/cookies).
