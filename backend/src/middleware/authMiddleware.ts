import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { supabaseAdmin, isSupabaseConfigured } from '../utils/supabaseClient';
const JWT_SECRET = process.env.JWT_SECRET || 'sih2026-super-secret-jwt-key';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

export interface AuthUser {
  id: string;
  role: string;
  name?: string;
  email?: string;
  supabaseAuthId?: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: No Bearer token supplied' });

  let supabaseAuthId: string | undefined;
  let email: string | undefined;

  // 1. Try validating via Supabase Auth API if configured
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data?.user) {
        supabaseAuthId = data.user.id;
        email = data.user.email;
      }
    } catch {
      // Fallback to cryptographic JWT verification
    }
  }

  // 2. Cryptographic JWT signature verification (Supabase JWT Secret or fallback JWT Secret)
  if (!supabaseAuthId) {
    try {
      const secretToVerify = SUPABASE_JWT_SECRET || JWT_SECRET;
      const decoded = jwt.verify(token, secretToVerify) as any;
      supabaseAuthId = decoded.sub || decoded.supabaseAuthId || decoded.id;
      email = decoded.email;
    } catch (jwtErr) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
  }

  if (!supabaseAuthId && !email) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }

  // 3. Resolve Application User & Role from PostgreSQL Database
  try {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          ...(supabaseAuthId ? [{ supabaseAuthId }] : []),
          ...(email ? [{ email: String(email).trim().toLowerCase() }] : [])
        ]
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Application user identity not found' });
    }

    // Automatically link supabaseAuthId if not yet associated
    if (!user.supabaseAuthId && supabaseAuthId) {
      await prisma.user.update({
        where: { id: user.id },
        data: { supabaseAuthId }
      }).catch(() => {});
    }

    req.user = {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      supabaseAuthId: user.supabaseAuthId || supabaseAuthId
    };

    next();
  } catch (dbErr) {
    console.error('User identity resolution failure:', dbErr);
    return res.status(500).json({ error: 'Internal statutory identity validation error' });
  }
};

export const authorize = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient statutory role privileges' });
    }
    next();
  };
};
