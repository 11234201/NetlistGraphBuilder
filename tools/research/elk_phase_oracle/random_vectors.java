import java.util.Random;
class RandomVectors {
    public static void main(String[] args) {
        Random random = new Random(1);
        long derived = random.nextLong();
        System.out.println("derived=" + derived);
        System.out.println("model=" + random.nextBoolean());
        random.setSeed(derived);
        for (int index=0; index<4; index++) {
            System.out.println(random.nextBoolean() + "," + random.nextDouble() + ","
                + (double)random.nextFloat() + "," + (double)random.nextFloat());
        }
    }
}
