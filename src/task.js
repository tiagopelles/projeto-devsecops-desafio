require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/task', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, descricao AS task FROM task'
        );

        res.json({
            status: 'Conectado ao Banco de Dados',
            itens: result.rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: 'Erro ao consultar o banco de dados.',
            itens: []
        });
    }
});

app.listen(3000, () => {
    console.log('Servidor disponível em http://localhost:3000');
});