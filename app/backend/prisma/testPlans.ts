import { prisma } from "../src/config/prisma";
import { getPatientPlans } from "../src/modules/rehabilitation-plans/rehab.service";

async function test() {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, role: true, firstName: true, lastName: true }
  });
  console.log("USERS:", JSON.stringify(users, null, 2));

  for (const u of users) {
    if (u.role === "patient") {
      const plans = await getPatientPlans(u.id, u.id, "patient");
      console.log(`PATIENT: ${u.username} (${u.firstName} ${u.lastName}), PLANS: ${plans.length}`);
      for (const p of plans) {
        console.log(`Plan: ${p.name}, Status: ${p.status}, Days: ${p.scheduleDays.length}`);
        const sampleDay = p.scheduleDays[0];
        if (sampleDay) {
          console.log(`Sample day 0: date=${sampleDay.scheduledDate}, status=${sampleDay.status}, exercises=${sampleDay.scheduledExercises.length}`);
          if (sampleDay.scheduledExercises[0]) {
            console.log(`Sample exercise:`, sampleDay.scheduledExercises[0]);
          }
        }
      }
    }
  }
}

test()
  .catch((e) => console.error("ERROR:", e))
  .finally(() => prisma.$disconnect());

