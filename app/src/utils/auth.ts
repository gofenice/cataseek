const bcrypt = require('bcryptjs');
import * as jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN as string;

if (!JWT_SECRET || !JWT_EXPIRES_IN) {
  throw new Error('JWT environment variables are not set');
}

export const hashPassword = async (password: string): Promise<string> => {
  return await bcrypt.hash(password, 10);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return await bcrypt.compare(password, hash);
};

export const generateToken = (payload: { tenantId: number; apiKey?: string; role?: string }): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
};

export const verifyToken = (token: string): any => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

export const generateApiKey = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

export const generateIndexName = (tenantId: number): string => {
  return `store_${tenantId}_products`;
};