#include <Arduino.h>

static_assert(sizeof(int) == 2 && sizeof(long) == 4, "Uno integer widths");
static_assert(sizeof(float) == 4 && sizeof(double) == 4, "Uno float widths");
static_assert(sizeof(byte) == 1 && sizeof(bool) == 1, "Uno byte/bool widths");

volatile long integers[16];
volatile float fractions[3];
extern "C" __attribute__((noinline)) void reference_done() { asm volatile("nop"); }

int main() {
  { volatile int a=5,b=2; integers[0]=a/b; }
  { volatile double a=2.9; int b=a; integers[1]=b; }
  { byte a=255; a++; integers[2]=a; }
  { bool a=2; integers[3]=a; }
  { volatile int a=512; integers[4]=map(a,0,1023,0,255); }
  { volatile int a=-5,b=2; integers[5]=a/b; integers[6]=a%b; }
  { byte a=255; a+=2; integers[7]=a; }
  { unsigned long a=4294967295UL; a++; integers[8]=a; }
  { byte a=255; integers[9]=a+1; }
  { volatile int a=-5; integers[10]=map(a,0,10,0,3); }
  { volatile long a=65535L; int b=a; integers[11]=b; }
  { volatile unsigned long a=4294967295UL; integers[12]=a*a; }
  { volatile int a=-1; volatile unsigned int b=1; integers[13]=a<b; }
  { volatile long a=-1; volatile unsigned int b=65535U; integers[14]=a<b; }
  { int value=1; if(true){int value=9; integers[15]=value;} integers[15]=value; }
  { volatile int a=5,b=2; fractions[0]=a/b; }
  { volatile double a=5.0; volatile int b=2; fractions[1]=a/b; }
  { volatile float a=16777216.0; a+=1.0; fractions[2]=a; }
  reference_done();
  for(;;) {}
}
