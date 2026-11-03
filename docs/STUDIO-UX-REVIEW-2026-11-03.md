# Estudio editorial, firmas y bibliotecas — 2026-11-03

Estado: publicado en Replit y verificado en producción el 2026-11-03. Interfaz `20261103-studio4`.

## Cambios solicitados

- Selector de páginas con etiqueta separada y un solo campo, sin el marco del listado anterior.
- Código HTML de las firmas visible, seleccionable y copiable. La vista previa muestra la firma completa, sin scroll interior, y se adapta al ancho disponible. Se corrigieron también el enlace telefónico y las acciones de descarga de las firmas guardadas.
- Indicador animado compartido para presentaciones, posts/carruseles y documentos: etapa real del servidor, contador de tiempo transcurrido, unidades cuando se conocen, finalización y error. Respeta movimiento reducido. No simula porcentajes de avance.
- Presentaciones mediante trabajos asíncronos recuperables desde el CMS, con seguimiento de contenido, imágenes, composición, archivos y guardado. Se mantiene la respuesta síncrona anterior para clientes que no solicitan `async:true`.
- Sol dirige los diseños sociales con controles de composición, escala del título y espacio. Se incorporaron fotografía lateral y fotografía editorial; las fotos ya no fuerzan todas las piezas a una sola plantilla.
- Cuatro paletas del sistema EJ: azul/dorado, blanco editorial, marfil/azul y grafito/dorado. Selección fija, automática o combinada; ajuste por pieza sin llamada de IA. Se conservan logo, fuentes y acentos institucionales.
- **Crear versión mejorada con Sol** revisa las piezas existentes, incluyendo hasta tres referencias visuales y la estructura de todo el carrusel. Devuelve decisiones de diseño y una explicación breve. Crea otro registro y conserva el original, sus palabras, sus fotos y el copy.
- Descarga PNG por pieza, con botón visible en cada miniatura y en la pieza abierta. El ZIP completo es opcional.
- Eliminar/restaurar en posts/carruseles, documentos y firmas. Confirmación antes de mover a una papelera recuperable. Los archivos permanecen privados; la descarga del registro eliminado devuelve 404 hasta restaurarlo.

## Implementación

`social-design.mjs` define paletas y controles válidos. `social-generator.mjs` produce HTML y PNG desde la misma composición; el usuario no introduce código ejecutable como dirección visual. La skill editorial pasa a `ej-content-studio-v2`. Se mantiene el modelo configurado Sol y GPT Image 2 para fotografías. Los prompts conservan hechos, contacto institucional y el criterio documental de México por defecto.

`generation-progress.js`/`.css` presentan el estado de los trabajos. Los productores emiten etapa, mensaje y unidades; la interfaz usa un indicador indeterminado cuando no hay una medida conocida. Los relojes se detienen al completar o fallar. Los metadatos persistentes no contienen insumos en los punteros de trabajo.

`studio-trash.mjs` exige sesión, permiso de edición, módulo y CSRF. Mantiene `deletedAt`, versión y restauración; los listados normales excluyen la papelera. La interfaz confirma el nombre del elemento y conserva el original de un rediseño. La biblioteca privada no constituye una nueva publicación de contenido.

Se corrigió una apertura inicial del lienzo social que podía quedar en blanco. La vista obtiene el HTML autenticado y lo muestra como `srcdoc` en un iframe sin permiso de scripts; el cliente puede editar los textos. Mientras carga se muestra un aviso y un fallo ofrece una indicación visible. No se relajó la CSP ni se añadieron scripts en los artefactos.

## Verificación

| Prueba | Resultado local |
|---|---|
| Social | Trabajo asíncrono, insumos/fotos, HTML editable/PNG, seis copies, edición sin IA y fuentes correctos |
| Diseñador | Solicitud Sol con referencias visuales; versión nueva, palabras/fotos/copy conservados y original presente |
| Paletas | Cuatro fondos verificados en los PNG; combinación en carrusel y edición manual sin llamadas de IA |
| Descarga individual | PNG con Content-Disposition attachment; descarga real de una pieza desde el navegador |
| Papelera | Eliminar/ocultar/404/restaurar, estado persistente y CSRF/rol comprobados; interfaz probada en los tres módulos |
| Presentaciones | Seguimiento del generador, trabajo HTTP 202 y resultado recuperable; PPTX nativo, proporciones, pies IA y fuentes conservados |
| Documentos | Texto íntegro, justificación, DOCX editable y membrete multipágina conservados; papelera restaurable |
| Firmas | HTML visible y clipboard idéntico; preview sin barras internas; cancelar conserva, eliminar/restaurar funciona |
| Móvil | 390 px de viewport, documento de 375 px con scrollbar: sin desbordamiento en páginas, firmas, posts y documentos |
| Navegador | Backend real aislado con proveedor simulado, cero advertencias/errores observados |
| Regresión | Seguridad y editor de contenido con guardado confirmado correctos |
| Replit | Ocho suites correctas en Node 20.20.0; personalizaciones remotas de autenticación y guardado conservadas |
| Producción | Selector corregido, HTML de firmas visible, cuatro paletas, diseñador habilitado y descargas por pieza; diseño anterior abierto con cinco nodos de texto editables |
| Archivos anteriores | Bibliotecas cargadas; imagen de una presentación anterior completa a 1600 px de ancho |
| Móvil de producción | Presentaciones, posts y firmas a 390 px; ancho de documento 375 px, sin desbordamiento; tamaño restaurado |
| Consola de producción | Cero errores/advertencias observados; no se iniciaron generaciones de pago ni se eliminaron registros reales |

Pruebas principales: `check-social-studio.mjs`, `check-documents.mjs`, `check-presentations.mjs`, `check-auth-security.mjs`, `check-security.mjs` y `check-cms-content.mjs`. Los tests usan datos y cuentas ficticios; no consumen créditos reales de OpenAI ni eliminan registros del cliente. La comprobación del contrato y los renders no acredita por sí sola la calidad de una nueva respuesta real del modelo.

La integración de imágenes de referencia sigue la [documentación oficial de OpenAI para entradas visuales en Responses](https://developers.openai.com/api/docs/guides/images-vision#analyze-images). El modelo elegido por el propietario se conserva; no se sustituyó por el modelo usado en los ejemplos de la documentación.

La publicación quedó Live y el HTML administrativo/los recursos nuevos responden 200 con la versión esperada y CSP. El panel real confirma `gpt-6.1-sol` y `gpt-image-2`. Los datos de las bibliotecas se comprobaron por conteos y controles, sin copiar su contenido privado. El scan de 148 fuentes de texto versionadas no encontró patrones conocidos de claves; este alcance no garantiza detectar todos los formatos posibles.

La integración remota validó los hashes de 24 archivos y aplicó cuatro parches más ocho sustituciones acotadas en el servidor compartido. La ruta anterior de eliminación de firmas se comprobó equivalente salvo formato y async/await antes de sustituirla por la papelera. El guardado remoto ya asíncrono se conservó. Se creó respaldo de la sesión bajo `/tmp/ej-studio-refinements-backup-*`; no sustituye una política de backup duradero. No se reemplazó completo el servidor ni `.replit`.

Evidencia local saneada en `data/local-build-work/studio-refinements-20261103/` y capturas de navegador. Las credenciales sintéticas se mantienen ignoradas y se retiran al cerrar el servidor de QA. `.replit`, Secrets, bases, fuentes privadas y referencias en `documentos ` permanecen fuera de esta entrega de código.
