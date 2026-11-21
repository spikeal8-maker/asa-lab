int d0=8;
int d1=9;
int d2=9;
unsigned long lastTick=0;
void setup(){for(int p=2;p<13;p++){pinMode(p,OUTPUT);}lastTick=millis();}
void loop(){scan(0,d2);
scan(1,d1);
scan(2,d0);if(millis()-lastTick>=40){increment();lastTick=millis();}}
void segments(int value){digitalWrite(2,value==0||value==2||value==3||value==5||value==6||value==7||value==8||value==9);
digitalWrite(3,value==0||value==1||value==2||value==3||value==4||value==7||value==8||value==9);
digitalWrite(4,value==0||value==1||value==3||value==4||value==5||value==6||value==7||value==8||value==9);
digitalWrite(5,value==0||value==2||value==3||value==5||value==6||value==8||value==9);
digitalWrite(6,value==0||value==2||value==6||value==8);
digitalWrite(7,value==0||value==4||value==5||value==6||value==8||value==9);
digitalWrite(8,value==2||value==3||value==4||value==5||value==6||value==8||value==9);
digitalWrite(9,LOW);}
void scan(int selector,int value){for(int p=10;p<13;p++){digitalWrite(p,LOW);}segments(value);digitalWrite(10+selector,HIGH);delay(2);digitalWrite(10+selector,LOW);}
void increment(){d0++;if(d0>=10){d0=0;d1++;if(d1>=10){d1=0;d2++;if(d2>=10){d2=0;}}}}
