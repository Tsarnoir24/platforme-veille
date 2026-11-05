import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWatchCategories1793100000000 implements MigrationInterface {
  name = 'AddWatchCategories1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "watch_categories" (
        "id" SERIAL NOT NULL,
        "code" character varying(60) NOT NULL,
        "name" character varying(150) NOT NULL,
        "description" text,
        "default_query" text,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_watch_categories_code" UNIQUE ("code"),
        CONSTRAINT "PK_watch_categories_id" PRIMARY KEY ("id")
      )
    `);

    // Insérer les catégories initiales par défaut si la table est vide
    await queryRunner.query(`
      INSERT INTO "watch_categories" ("code", "name", "description", "default_query", "active")
      VALUES
        ('SCIENTIFIQUE', 'Scientifique', 'Publications, articles de recherche et innovations analytiques.', 'scientifique, recherche, étude, laboratoire, microbiologie, analyse, chromatographie, spectrométrie', true),
        ('REGLEMENTAIRE', 'Réglementaire', 'Lois, décrets, arrêtés, avis sanitaires, limites LMR et alertes officielles.', 'règlement, directive, décret, loi, conformité, législation, avis sanitaire, LMR, rappel', true),
        ('ACCREDITATION', 'Accréditation', 'Exigences COFRAC, SOAC, audits et essais d’aptitude inter-laboratoires.', 'ISO 17025, ISO/IEC 17025, accréditation, COFRAC, SOAC, audit, essai d’aptitude, intercomparaison', true),
        ('NORMATIF', 'Normatif', 'Normes techniques internationales, AFNOR, CEN, ISO, CEI et Codex.', 'norme, standard, ISO, IEC, AFNOR, ASTM, normalisation, spécification technique', true),
        ('ENVIRONNEMENT', 'Environnement', 'Écologie, pollutions (eau, air, sol), rejets, effluents et risques climatiques.', 'environnement, pollution, eau, eau potable, pesticide, sol, effluent, déchet, résidu', true),
        ('AUTRE', 'Autre', 'Informations administratives ou générales ne rentrant pas dans les catégories précédentes.', '', true)
      ON CONFLICT ("code") DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "watch_categories"`);
  }
}

