-- ===========================================================================
-- Pokédex TCG · esquema MySQL / MariaDB
-- Ejecutar una sola vez en phpMyAdmin (hPanel → Bases de datos → phpMyAdmin)
-- o con:  npm run migrar
-- ===========================================================================

-- --------------------------------------------------------------- usuarios --
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,          -- bcrypt, nunca la contraseña en claro
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP    NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------- Módulo 1: Pokédex Nacional --
-- Una fila por especie registrada. La PK compuesta garantiza el invariante
-- del proyecto: 1 Pokémon = 1 carta por usuario.
CREATE TABLE IF NOT EXISTS pokedex_entries (
  user_id    INT UNSIGNED NOT NULL,
  dex_id     SMALLINT UNSIGNED NOT NULL,        -- nº de Pokédex Nacional
  card_id    VARCHAR(64)  NOT NULL,             -- p.ej. sv3pt5-173
  card_name  VARCHAR(128) NOT NULL DEFAULT '',
  card_image VARCHAR(255) NOT NULL DEFAULT '',
  set_name   VARCHAR(128) NOT NULL DEFAULT '',
  -- "La tengo, pero sigo buscando otra versión": arte alterno, rareza distinta,
  -- reimpresión… El slot cuenta como obtenido, pero se marca en rojo.
  wants_alt  TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, dex_id),
  KEY idx_pokedex_wants_alt (user_id, wants_alt),
  CONSTRAINT fk_pokedex_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------ Módulo 2: Illustration Rares --
CREATE TABLE IF NOT EXISTS rare_entries (
  user_id        INT UNSIGNED NOT NULL,
  card_id        VARCHAR(64)  NOT NULL,
  card_condition ENUM('NM','LP','MP','HP','DMG') NOT NULL DEFAULT 'NM',
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, card_id),
  CONSTRAINT fk_rares_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------- sesiones --
-- express-mysql-session la crea sola, pero la dejamos explícita para que
-- exista con el juego de caracteres correcto desde el principio.
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) NOT NULL,
  expires    INT UNSIGNED NOT NULL,
  data       MEDIUMTEXT,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
