USE Pruebas;

-- Abonos (pagos parciales) hechos a una editorial. `editorial` guarda el mismo
-- texto que libros.autor, ya que todavía no existe una tabla de editoriales.
CREATE TABLE IF NOT EXISTS abonos_editorial (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  editorial  VARCHAR(150)  NOT NULL,
  monto      DECIMAL(10,2) NOT NULL,
  fecha      DATE          NOT NULL,
  notas      VARCHAR(255),
  usuario_id INT,
  creado_en  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
