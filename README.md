# sevenpan

Aplicación B2B para la panadería matriz y sus panaderías clientes. El catálogo usa precios globales para nuevas comandas; cada ítem guarda el precio aplicado para conservar el historial.

## Desarrollo

1. Copiá `.env.example` a `.env.local` y completá la clave publicable del proyecto.
2. Ejecutá `npm install` y `npm run dev`.
3. Las migraciones versionadas están en `supabase/migrations/` y las funciones en `supabase/functions/`.

## Rutas de la aplicación

- Panaderías: `/inicio`, `/hacer-pedido`, `/pedidos`, `/estadisticas`, `/mi-panaderia`.
- Administración: `/admin`, `/admin/pedidos`, `/admin/clientes`, `/admin/clientes/:codigo`, `/admin/productos`.
- El historial del navegador mantiene la navegación entre pantallas y permite abrir directamente una ruta luego de iniciar sesión.

## Endpoints autenticados

- `POST /functions/v1/orders`: crear una comanda.
- `PATCH /functions/v1/orders/:id`: editar una comanda pendiente.
- `DELETE /functions/v1/orders/:id`: cancelar una comanda pendiente.
- `GET /functions/v1/me`: consultar la panadería asociada.
- `PATCH /functions/v1/me`: actualizar dirección, localidad, teléfono e indicaciones de entrega.
- `POST /functions/v1/admin/customers/invite`: invitar una panadería.
- `POST /functions/v1/admin/products`: crear un producto.
- `PATCH /functions/v1/admin/products/:id`: actualizar precio o disponibilidad.
- `PATCH /functions/v1/admin/orders/:id/status`: actualizar el estado de un pedido.

Nunca agregues `SUPABASE_SERVICE_ROLE_KEY` ni otra clave secreta a variables `VITE_*`: la clave de servicio se utiliza exclusivamente dentro de las Edge Functions.

## Primer administrador

No existe registro público. Creá la primera cuenta con correo y contraseña desde **Authentication > Users** en Supabase y, con su UUID, ejecutá en el SQL Editor:

```sql
select private.bootstrap_admin('UUID_DEL_USUARIO', 'Nombre de administración');
```

Luego esa cuenta podrá ingresar al panel y enviar invitaciones a panaderías clientes. La URL de sitio de Auth debe apuntar al frontend publicado para que las invitaciones abran el destino correcto.

## Producción

- Definí el secreto de Edge Functions `APP_URL` con la URL exacta del frontend para limitar CORS.
- Configurá esa misma URL en **Authentication > URL Configuration**.
- Aplicá las migraciones en orden y desplegá `orders`, `me` y `admin` con JWT obligatorio.
- Las comandas se crean, editan o cancelan hasta las 18:00 de `America/Montevideo`; la validación está en la base, no solo en la interfaz.
