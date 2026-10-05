-- Esquema relacional do sistema agroindustrial SSE2 (seção 5 da especificação)
-- Compatível com PostgreSQL. Não é usado pelo servidor (o RF-08 pede log em memória);
-- serve como implementação do diagrama ER para persistência futura.

CREATE TABLE unidade_armazenamento (
    id_unidade                 SERIAL PRIMARY KEY,
    nome_fazenda               VARCHAR(100) NOT NULL,
    localizacao_geografica     VARCHAR(100),
    capacidade_total_toneladas DECIMAL(10,2) CHECK (capacidade_total_toneladas >= 0),
    responsavel_tecnico        VARCHAR(100)
);

CREATE TABLE silo (
    id_silo               SERIAL PRIMARY KEY,
    id_unidade            INT NOT NULL REFERENCES unidade_armazenamento(id_unidade),
    codigo_silo           VARCHAR(20) NOT NULL UNIQUE,
    capacidade_maxima_m3  DECIMAL(10,2) CHECK (capacidade_maxima_m3 > 0),
    tipo_grao_armazenado  VARCHAR(50) CHECK (tipo_grao_armazenado IN ('SOJA','MILHO','TRIGO','SORGO')),
    status_operacional    VARCHAR(30) NOT NULL DEFAULT 'NORMAL'
        CHECK (status_operacional IN ('NORMAL','ALERTA_CO2','SUPERAQUECIDO','BLOQUEADO_PARA_CARGA')),
    data_ultima_inspecao  DATE
);

CREATE TABLE leitura_telemetria (
    id_leitura               BIGSERIAL PRIMARY KEY,
    id_silo                  INT NOT NULL REFERENCES silo(id_silo),
    temperatura_celsius      DECIMAL(5,2),
    umidade_relativa_pct     DECIMAL(5,2) CHECK (umidade_relativa_pct BETWEEN 0 AND 100),
    co2_ppm                  DECIMAL(7,2) CHECK (co2_ppm >= 0),
    nivel_preenchimento_pct  DECIMAL(5,2) CHECK (nivel_preenchimento_pct BETWEEN 0 AND 100),
    data_hora_leitura        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_leitura_silo_data ON leitura_telemetria (id_silo, data_hora_leitura DESC);

CREATE TABLE atuador (
    id_atuador        SERIAL PRIMARY KEY,
    id_silo           INT NOT NULL REFERENCES silo(id_silo),
    tipo_atuador      VARCHAR(40) NOT NULL CHECK (tipo_atuador IN ('COMPORTA_EXAUSTAO','EXAUSTOR_TETO','AERADOR')),
    status_atual      VARCHAR(20) NOT NULL CHECK (status_atual IN ('ABERTO','FECHADO','LIGADO','DESLIGADO','FALHA')),
    modo_operacao     VARCHAR(20) NOT NULL DEFAULT 'AUTOMATICO' CHECK (modo_operacao IN ('AUTOMATICO','MANUAL')),
    data_ultima_acao  TIMESTAMP
);

CREATE TABLE ocorrencia_alerta (
    id_alerta         BIGSERIAL PRIMARY KEY,
    id_silo           INT NOT NULL REFERENCES silo(id_silo),
    tipo_evento       VARCHAR(50) NOT NULL,
    nivel_severidade  VARCHAR(20) NOT NULL CHECK (nivel_severidade IN ('ATENCAO','ALERTA','CRITICO')),
    mensagem_detalhe  TEXT,
    data_hora_evento  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reconhecido       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_alerta_silo_data ON ocorrencia_alerta (id_silo, data_hora_evento DESC);

-- Dados de exemplo coerentes com o simulador
INSERT INTO unidade_armazenamento (nome_fazenda, localizacao_geografica, capacidade_total_toneladas, responsavel_tecnico)
VALUES ('Complexo Armazenador Rio Verde', 'Rio Verde - GO', 17500, 'Eng. Agr. Responsável Técnico');

INSERT INTO silo (id_unidade, codigo_silo, capacidade_maxima_m3, tipo_grao_armazenado) VALUES
 (1, 'SILO-01', 5600, 'MILHO'),
 (1, 'SILO-02', 6700, 'SOJA'),
 (1, 'SILO-03', 4900, 'TRIGO'),
 (1, 'SILO-04', 6000, 'MILHO');

INSERT INTO atuador (id_silo, tipo_atuador, status_atual)
SELECT s.id_silo, t.tipo, t.status
FROM silo s
CROSS JOIN (VALUES ('COMPORTA_EXAUSTAO','FECHADO'), ('EXAUSTOR_TETO','DESLIGADO'), ('EXAUSTOR_TETO','DESLIGADO')) AS t(tipo, status);
