import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { supabaseAdmin, isSupabaseConfigured } from '../src/utils/supabaseClient';

dotenv.config();
const prisma = new PrismaClient();

const DEMO_PERSONAS = [
  {
    email: 'admin@emaanak.gov.in',
    password: 'admin123',
    role: 'ADMIN',
    name: 'Dr. A. K. Verma (Controller)',
    fallbackAuthId: 'sb_auth_admin_001'
  },
  {
    email: 'v.sharma@emaanak.gov.in',
    password: 'officer123',
    role: 'OFFICER',
    name: 'Inspector Vikram Sharma',
    fallbackAuthId: 'sb_auth_officer_sharma_001'
  },
  {
    email: 'p.patel@emaanak.gov.in',
    password: 'officer123',
    role: 'OFFICER',
    name: 'Inspector Priya Patel',
    fallbackAuthId: 'sb_auth_officer_patel_001'
  },
  {
    email: 'techcorp@example.com',
    password: 'owner123',
    role: 'OWNER',
    name: 'TechCorp Industries Ltd.',
    fallbackAuthId: 'sb_auth_owner_techcorp_001'
  },
  {
    email: 'shop@example.com',
    password: 'shop123',
    role: 'OWNER',
    name: 'Sharma General & Retail Store',
    fallbackAuthId: 'sb_auth_owner_shop_001'
  },
  {
    email: 'shop@kirana.com',
    password: 'shop123',
    role: 'OWNER',
    name: 'Metro Kirana & Retail Mart',
    fallbackAuthId: 'sb_auth_owner_kirana_001'
  },
  {
    email: 'agriproducts@example.com',
    password: 'owner123',
    role: 'OWNER',
    name: 'Apex Agro Commodities',
    fallbackAuthId: 'sb_auth_owner_agro_001'
  },
  {
    email: 'metrofuel@example.com',
    password: 'owner123',
    role: 'OWNER',
    name: 'Metro Logistics & Fuel Hub',
    fallbackAuthId: 'sb_auth_owner_metro_001'
  }
];

export async function provisionSupabaseUsers() {
  console.log('[Supabase Provisioning] Initializing demo persona sync...');

  let existingSupabaseUsers: any[] = [];
  const supabaseActive = isSupabaseConfigured();

  if (supabaseActive) {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers();
      if (!error && data?.users) {
        existingSupabaseUsers = data.users;
        console.log(`[Supabase Provisioning] Discovered ${existingSupabaseUsers.length} existing Supabase Auth identities.`);
      }
    } catch (err) {
      console.warn('[Supabase Provisioning] Supabase Auth API not reachable or service key unauthorized. Using local mapped identities.');
    }
  } else {
    console.log('[Supabase Provisioning] Supabase keys not set in environment. Mapping fallback deterministic Auth IDs.');
  }

  for (const persona of DEMO_PERSONAS) {
    let authId = persona.fallbackAuthId;

    if (supabaseActive) {
      const existing = existingSupabaseUsers.find(u => u.email?.toLowerCase() === persona.email.toLowerCase());
      if (existing) {
        authId = existing.id;
        console.log(`[Supabase Provisioning] Existing Supabase user matched for ${persona.email}: ${authId}`);
      } else {
        try {
          const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
            email: persona.email,
            password: persona.password,
            email_confirm: true,
            user_metadata: { name: persona.name, role: persona.role }
          });

          if (!error && created?.user) {
            authId = created.user.id;
            console.log(`[Supabase Provisioning] Created new Supabase Auth user for ${persona.email}: ${authId}`);
          } else {
            console.warn(`[Supabase Provisioning] Could not create Supabase Auth user (${persona.email}):`, error?.message);
          }
        } catch (err: any) {
          console.warn(`[Supabase Provisioning] Error creating Supabase user ${persona.email}:`, err.message);
        }
      }
    }

    // Upsert / Link to application User table
    const passwordHash = await bcrypt.hash(persona.password, 10);
    const appUser = await prisma.user.findUnique({ where: { email: persona.email } });
    let userId: string;
    if (appUser) {
      await prisma.user.update({
        where: { id: appUser.id },
        data: {
          supabaseAuthId: authId,
          role: persona.role,
          name: persona.name,
          passwordHash
        }
      });
      userId = appUser.id;
      console.log(`[Supabase Provisioning] Linked application user ${persona.email} (ID: ${appUser.id}) -> supabaseAuthId: ${authId}`);
    } else {
      const created = await prisma.user.create({
        data: {
          email: persona.email,
          name: persona.name,
          role: persona.role,
          supabaseAuthId: authId,
          passwordHash
        }
      });
      userId = created.id;
      console.log(`[Supabase Provisioning] Created application user ${persona.email} (ID: ${created.id}) -> supabaseAuthId: ${authId}`);
    }

    // Seed realistic retail instruments for shop personas if none exist
    if (persona.email === 'shop@example.com') {
      const existingInstruments = await prisma.instrument.count({ where: { ownerId: userId } });
      if (existingInstruments === 0) {
        console.log(`[Supabase Provisioning] Seeding retail instruments for ${persona.email}...`);
        const officer = await prisma.user.findUnique({ where: { email: 'v.sharma@emaanak.gov.in' } });
        
        // Instrument 1: Verified Class II Counter Scale with Valid Certificate & QR
        const inst1 = await prisma.instrument.create({
          data: {
            ownerId: userId,
            type: 'Electronic Weighing Scale (Class II)',
            manufacturer: 'Essae-Teraoka Ltd.',
            model: 'DS-252 Counter Scale',
            serialNumber: 'SN-SH-99221100',
            maxCapacity: 30.0,
            verificationInterval: 0.005, // e = 5g
            status: 'VERIFIED',
          }
        });

        if (officer) {
          const app1 = await prisma.verificationApplication.create({
            data: {
              instrumentId: inst1.id,
              applicantId: userId,
              status: 'APPROVED',
              createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
            }
          });

          const insp1 = await prisma.verificationInspection.create({
            data: {
              applicationId: app1.id,
              officerId: officer.id,
              ruleVersion: 'LM-RULE-2026.1',
              result: 'PASS',
              remarks: 'Class II retail counter scale verified. Lead stamp intact. Within MPE tolerances.',
              createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
            }
          });

          await prisma.verificationReading.createMany({
            data: [
              {
                inspectionId: insp1.id,
                pointName: 'Minimum Operating Load (20% Max)',
                referenceLoad: 6.0,
                observedValue: 6.001,
                error: 0.001,
                percentageError: 0.016,
                maxPermissibleError: 0.005,
                status: 'PASS'
              },
              {
                inspectionId: insp1.id,
                pointName: 'Mid-Scale Operational Load (50% Max)',
                referenceLoad: 15.0,
                observedValue: 15.002,
                error: 0.002,
                percentageError: 0.013,
                maxPermissibleError: 0.005,
                status: 'PASS'
              },
              {
                inspectionId: insp1.id,
                pointName: 'Maximum Rated Capacity (100% Max)',
                referenceLoad: 30.0,
                observedValue: 30.003,
                error: 0.003,
                percentageError: 0.01,
                maxPermissibleError: 0.005,
                status: 'PASS'
              }
            ]
          });

          await prisma.certificate.create({
            data: {
              inspectionId: insp1.id,
              certificateNumber: 'CERT-2026-SH01',
              issueDate: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
              expiryDate: new Date(Date.now() + 340 * 24 * 60 * 60 * 1000),
              status: 'VALID',
              qrToken: 'tok_active_shop_counter_scale_01'
            }
          });
        }

        // Instrument 2: Pending Class II Scale
        const inst2 = await prisma.instrument.create({
          data: {
            ownerId: userId,
            type: 'Electronic Weighing Scale (Class II)',
            manufacturer: 'Crown Scales India',
            model: 'CR-15 Retail Digital',
            serialNumber: 'SN-SH-44556677',
            maxCapacity: 15.0,
            verificationInterval: 0.002, // e = 2g
            status: 'PENDING',
          }
        });

        await prisma.verificationApplication.create({
          data: {
            instrumentId: inst2.id,
            applicantId: userId,
            status: 'SUBMITTED',
            createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          }
        });

        console.log(`[Supabase Provisioning] Retail instruments successfully seeded for ${persona.email}`);
      }
    }
  }

  console.log('[Supabase Provisioning] Demo persona synchronization completed successfully.');
}

if (require.main === module) {
  provisionSupabaseUsers()
    .catch((e) => {
      console.error('Provisioning failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
