import express from 'express';
import { autocomplete, validate } from '../controllers/address.controller.js';

const router = express.Router();

router.get('/autocomplete', autocomplete);
router.post('/validate', validate);

export default router;
