-- ===========================================================================
-- Migración para producción (Hostinger / phpMyAdmin)
-- Pega esto en: hPanel → Bases de datos → phpMyAdmin → tu base → pestaña SQL
-- (ya estarás dentro de la base correcta, por eso no lleva "USE ...;")
--
-- Combina, en orden: mejoras_v2.sql + mejoras_v3.sql (Papelería)
-- y db/schema.sql de la Pokédex. Asume que schema.sql original de la
-- Papelería (usuarios, libros, maestros, ventas) YA existe en esta base,
-- porque es la que usa la v1 en producción.
-- ===========================================================================

-- ── Papelería: mejoras_v2.sql ────────────────────────────────────────────
-- 1) Tabla intermedia libro <-> maestro (muchos a muchos)
CREATE TABLE IF NOT EXISTS libro_maestro (
  libro_id   INT NOT NULL,
  maestro_id INT NOT NULL,
  PRIMARY KEY (libro_id, maestro_id),
  FOREIGN KEY (libro_id)   REFERENCES libros(id)   ON DELETE CASCADE,
  FOREIGN KEY (maestro_id) REFERENCES maestros(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Reestructurar ventas: encabezado + detalle
-- Confirmado con el usuario: la tabla `ventas` en producción no tiene ventas
-- reales que conservar (vacía o solo datos de prueba), así que se recrea.
DROP TABLE IF EXISTS ventas;

CREATE TABLE ventas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  alumno_nombre VARCHAR(150)  NOT NULL,
  grado         VARCHAR(20)   NOT NULL,
  grupo         VARCHAR(20)   NOT NULL,
  turno         VARCHAR(20)   NOT NULL,
  especialidad  VARCHAR(100)  NOT NULL,
  total         DECIMAL(10,2) NOT NULL DEFAULT 0,
  fecha         DATETIME      DEFAULT CURRENT_TIMESTAMP,
  usuario_id    INT,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE venta_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  venta_id   INT NOT NULL,
  libro_id   INT NOT NULL,
  maestro_id INT NOT NULL,
  precio     DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (venta_id)   REFERENCES ventas(id)   ON DELETE CASCADE,
  FOREIGN KEY (libro_id)   REFERENCES libros(id),
  FOREIGN KEY (maestro_id) REFERENCES maestros(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Papelería: mejoras_v3.sql ────────────────────────────────────────────
ALTER TABLE libros
  ADD COLUMN comision_maestro DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER margen_papeleria;

-- ── Pokédex: db/schema.sql ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP    NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pokedex_entries (
  user_id    INT UNSIGNED NOT NULL,
  dex_id     SMALLINT UNSIGNED NOT NULL,
  card_id    VARCHAR(64)  NOT NULL,
  card_name  VARCHAR(128) NOT NULL DEFAULT '',
  card_image VARCHAR(255) NOT NULL DEFAULT '',
  set_name   VARCHAR(128) NOT NULL DEFAULT '',
  wants_alt  TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, dex_id),
  KEY idx_pokedex_wants_alt (user_id, wants_alt),
  CONSTRAINT fk_pokedex_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rare_entries (
  user_id        INT UNSIGNED NOT NULL,
  card_id        VARCHAR(64)  NOT NULL,
  card_condition ENUM('NM','LP','MP','HP','DMG') NOT NULL DEFAULT 'NM',
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, card_id),
  CONSTRAINT fk_rares_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) NOT NULL,
  expires    INT UNSIGNED NOT NULL,
  data       MEDIUMTEXT,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
